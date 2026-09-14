/**
 * The Core-side control endpoint a Runner calls (`docs/architecture/protocol.md` §6).
 *
 * §6 is the internal channel between Core and a Runner:
 *
 * > 内部接口必须有attempt capability；客户端不得直接调用。expectedVersion目标为Work
 * > （assessment/dispatch）或Task/Run（stage）。所有调用带operationId以便重派去重。
 *
 * The Chief submits its assessment and dispatches professional Runs through
 * `assessment.submit`/`agent.dispatch`, and a professional Run submits its delivery through
 * `stage.submit` (the Pi tool `stage_yield` maps onto it), and a professional Run calls
 * `tool.execute` for every read, edit or shell command (T3, plan D-T3-3 keeps it on this
 * same endpoint). This module is the transport for those four methods: it mirrors the model
 * gateway endpoint (`gateway-http.ts`) exactly, because the authority model is the same one
 * `execution.md` §2 fixes for the gateway — the Runner holds only a short-lived attempt
 * capability, and Core re-checks that capability against the *current* Attempt on every
 * call.
 *
 * What this module deliberately does not do:
 *
 * - it never parses a method out of model text. The Runner's Pi session calls the endpoint
 *   through a registered tool, so a compliant submission is a real call, not a guess;
 * - it owns no business state. The three handlers are injected by whoever assembles the
 *   stack (the daemon), so Core's protocol layer stays free of application dependencies;
 * - it never decides what a submission *means*. `noteSubmitted` only observes that a
 *   submission was accepted; the correction/`contract_violation` policy is applied by the
 *   caller (see `protocol.md` §6 and the note under the table: "普通文本结束没有该结果时Run
 *   等待提交提示，连续两次不合规为contract_violation").
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { JsonObject, Role } from '@agentdev/contracts';
import { uuidv7, type ProjectStore } from '@agentdev/storage';

import type { AttemptCapabilityStore } from './capabilities.js';
import { ProtocolError } from './errors.js';
import { handleToolExecute, type ToolExecuteHandler } from './tool-http.js';

/** One authenticated submission, with the binding Core — not the Runner — decided. */
export interface ControlCaller {
  readonly runId: string;
  readonly attemptId: string;
  /**
   * The Attempt's own epoch (`attempt.ownerEpoch`), which is what `protocol.md` §6
   * `stage.submit` names.
   *
   * The capability carries the fencing generation instead (`ownerEpoch + 1`); the two are
   * checked separately in `authenticate`, so a caller can never present a capability and an
   * Attempt epoch that disagree.
   */
  readonly epoch: number;
  readonly role: Role;
}

/**
 * The frozen handler surface the daemon injects.
 *
 * Every handler receives the capability-derived caller: a Runner cannot name its own Run,
 * Attempt or epoch, so an accepted call is always attributed to the Attempt that holds the
 * capability. A handler that throws a `ProtocolError` is answered with the matching HTTP
 * status and the protocol code, which is what lets the Runner tell a correctable
 * `VALIDATION_ERROR` from a terminal refusal.
 */
export interface ControlHandler {
  /** `protocol.md` §6 `assessment.submit` (chief). */
  assessmentSubmit(input: {
    readonly caller: ControlCaller;
    readonly workId: string;
    readonly assessment: JsonObject;
    readonly operationId?: string;
    /** `protocol.md` §6: the Work version the caller believes is current. */
    readonly expectedVersion?: number;
  }): JsonObject;
  /** `protocol.md` §6 `agent.dispatch` (chief): one frozen `ProfessionalDispatchSpec`. */
  agentDispatch(input: {
    readonly caller: ControlCaller;
    readonly spec: JsonObject;
    readonly operationId?: string;
    readonly expectedVersion?: number;
  }): JsonObject;
  /** `protocol.md` §6 `stage.submit` (professional): one `StageResult`. */
  stageSubmit(input: {
    readonly caller: ControlCaller;
    readonly result: JsonObject;
    readonly operationId?: string;
    readonly expectedVersion?: number;
  }): JsonObject;
  /**
   * `protocol.md` §6 `context.request` (T3 轮 2): append reads inside the Run's scope.
   *
   * Returns the resolved content and the ledger entry for each ref; a ref the Run's ACL
   * does not cover is recorded as a pending expansion and escalated to the Chief instead of
   * being silently dropped (`AC-032`). Optional, like the tool handlers: a stack without it
   * refuses the method rather than pretending the read happened.
   */
  contextRequest?(input: {
    readonly caller: ControlCaller;
    readonly workId: string;
    readonly requestedRefs: readonly JsonObject[];
    readonly reason: string;
  }): JsonObject;
  /**
   * `protocol.md` §6 `agent.request_dispatch` (professional): asks the Chief for another
   * role. The professional cannot create a grandchild Run itself, so the answer is the
   * `chief_action_required` event (`rules/agents.md` §3), never a Run.
   */
  agentRequestDispatch?(input: {
    readonly caller: ControlCaller;
    readonly workId: string;
    readonly reason: string;
    readonly requestedRole: string;
    readonly goal: string;
    readonly sourceRefs: readonly JsonObject[];
  }): JsonObject;
  /**
   * `docs/rules/agents.md` §7 / `execution.md` §7 `decision_request` (Chief): asks the user
   * a product question.
   *
   * The question body becomes a real Artifact (`kind='decision'`) and the Decision's
   * `targetRef` points at it, because `protocol.md` §7 keeps event `data` to a summary and
   * says the full content is fetched by `get`. The answer arrives through the ordinary
   * `decision.resolve`, so the Chief's question needs no second resolution path.
   */
  decisionRequest?(input: {
    readonly caller: ControlCaller;
    readonly workId: string;
    readonly question: string;
    readonly choices: readonly string[];
  }): JsonObject;
}

/**
 * The Runner-side permission request (`protocol.md` §4 `permission.request`, T3).
 *
 * A professional Run that is refused by the Broker asks Core to record a user decision.
 * The Runner names the call it attempted (the same `toolOperationId`/`inputHash` it sent to
 * `tool.execute`) and Core resolves the real binding from that recorded operation, so a
 * Runner can only ask for authority over a call it really made.
 */
export interface PermissionRequestHandler {
  request(input: {
    readonly caller: ControlCaller;
    readonly toolName: string;
    readonly args: JsonObject;
    readonly toolOperationId: string;
    readonly inputHash: string;
  }): JsonObject;
}

export interface ControlEndpointOptions {
  readonly store: ProjectStore;
  readonly capabilities: AttemptCapabilityStore;
  readonly handler: ControlHandler;
  /**
   * Called after an accepted submission.
   *
   * The supervisor uses it to know that this Attempt delivered a structured result, which is
   * the mechanical half of the two-strike rule; the semantic half (which method counts for
   * which role) stays with `onAttemptResult` in the daemon.
   */
  readonly noteSubmitted?: (input: {
    readonly runId: string;
    readonly attemptId: string;
    readonly method: 'assessment.submit' | 'agent.dispatch' | 'stage.submit';
  }) => void;
  /**
   * The tool bridge handler (`protocol.md` §6 `tool.execute`, T3).
   *
   * Absent means this daemon has no tool path: the endpoint then refuses the method with
   * `PROVIDER_UNAVAILABLE` instead of pretending a tool call succeeded. The handler owns
   * planning, the Broker invocation and the Core-implemented tool bodies
   * (`apps/daemon/src/tool-handler.ts`); this endpoint owns authentication, the request
   * body's shape and the answer's transport.
   */
  readonly toolExecute?: ToolExecuteHandler;
  /**
   * The permission-request handler (`protocol.md` §4 `permission.request`, T3).
   *
   * Absent means the daemon cannot record permissions; the endpoint then refuses the method
   * with `PROVIDER_UNAVAILABLE` rather than telling a Runner a decision exists.
   */
  readonly permissionRequest?: PermissionRequestHandler;
  /** 0 asks the OS for a free port (tests use this). */
  readonly port?: number;
  readonly host?: '127.0.0.1' | '::1' | 'localhost';
  readonly maxBodyBytes?: number;
  readonly log?: (line: string) => void;
}

export interface ControlEndpoint {
  readonly server: Server;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

/** The documented paths; the name after `/control/` is the protocol method. */
export const CONTROL_PATHS = {
  assessmentSubmit: '/control/assessment.submit',
  agentDispatch: '/control/agent.dispatch',
  stageSubmit: '/control/stage.submit',
  /**
   * The tool bridge (`protocol.md` §6 `tool.execute`, T3).
   *
   * It shares this endpoint on purpose (plan D-T3-3): one capability channel, one
   * `authenticate`, no second copy of the security-critical checks.
   */
  toolExecute: '/control/tool.execute',
  /** The Runner's "I was refused; ask the user" call (T3, `protocol.md` §4). */
  permissionRequest: '/control/permission.request',
  /** `protocol.md` §6 `context.request` (T3 轮 2). */
  contextRequest: '/control/context.request',
  /** `protocol.md` §6 `agent.request_dispatch` (T3 轮 2). */
  agentRequestDispatch: '/control/agent.request_dispatch',
  /** `execution.md` §7 `decision_request` (Chief, T3 轮 3). */
  decisionRequest: '/control/decision.request',
} as const;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body)}\n`);
}

/** Every refusal is logged: a refused Runner call must never look like a quiet success. */
function refuse(
  response: ServerResponse,
  log: (line: string) => void,
  status: number,
  code: string,
  message: string,
): void {
  log(`control-endpoint: refused ${String(status)} ${code}: ${message}`);
  sendJson(response, status, { error: { code, message } });
}

/** The HTTP status a protocol error code maps onto (`protocol.md` §7, `gateway-http.ts`). */
export function statusForControlCode(code: string): number {
  switch (code) {
    case 'CONFIG_INVALID':
    case 'VALIDATION_ERROR':
    case 'MISSING_CONTEXT':
    case 'BUDGET_EXCEEDED':
      return 400;
    case 'NOT_AUTHORIZED':
    case 'UNAUTHENTICATED':
      return 401;
    // `CONTEXT_FORBIDDEN` is a source outside the reader's frozen scope (`context.md` §1,
    // `AC-032`): the call is forbidden and Chief handles the wider need through
    // `context.request`.
    case 'AUTH_EXPIRED':
    case 'CONTEXT_FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'VERSION_CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
    case 'INVALID_STATE':
    case 'GATE_NOT_READY':
    case 'STALE_ARTIFACT':
    case 'RECOVERY_REQUIRED':
    case 'BUSY':
      return 409;
    case 'PROVIDER_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}

/** Payload-too-large is a typed 4xx, matching the admin surface's 413 (review P3-1). */
class PayloadTooLargeError extends ProtocolError {
  constructor(limit: number) {
    super('VALIDATION_ERROR', `the request body is larger than ${String(limit)} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    if (bytes > limit) throw new PayloadTooLargeError(limit);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The documented members of one control request; anything else is refused (§1). */
const CONTROL_FIELDS: Record<string, readonly string[]> = {
  'assessment.submit': [
    'attemptId',
    'epoch',
    'workId',
    'assessment',
    'operationId',
    'expectedVersion',
  ],
  'agent.dispatch': ['attemptId', 'epoch', 'spec', 'operationId', 'expectedVersion'],
  'stage.submit': ['attemptId', 'epoch', 'result', 'operationId', 'expectedVersion'],
  'tool.execute': [
    'attemptId',
    'epoch',
    'toolName',
    'args',
    'toolOperationId',
    'expectedInputHash',
    'timeoutMs',
  ],
  'permission.request': ['attemptId', 'epoch', 'toolName', 'args', 'toolOperationId', 'inputHash'],
  'context.request': ['attemptId', 'epoch', 'workId', 'requestedRefs', 'reason'],
  'agent.request_dispatch': [
    'attemptId',
    'epoch',
    'workId',
    'reason',
    'requestedRole',
    'goal',
    'sourceRefs',
  ],
  'decision.request': ['attemptId', 'epoch', 'workId', 'question', 'choices'],
};

/** Rejects unknown members (`protocol.md` §1: 未知字段 → VALIDATION_ERROR). */
function assertKnownFields(method: string, body: JsonObject): void {
  const allowed = CONTROL_FIELDS[method] ?? [];
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ProtocolError('VALIDATION_ERROR', `unknown fields: ${unknown.join(', ')}`, {
      details: { method, unknown },
    });
  }
}

/** The body's `expectedVersion` (integer) when the caller sent one. */
function expectedVersionOf(body: JsonObject): number | undefined {
  const value = body['expectedVersion'];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ProtocolError('VALIDATION_ERROR', 'expectedVersion must be an integer');
  }
  return value;
}

/**
 * Rejects a scope path the control channel must never carry.
 *
 * `repoPathSchema` already refuses absolute paths, `..` segments and NUL; this is the
 * *entry* check the security review asked for (`~`, a drive letter, an empty path), so the
 * control channel does not depend on the derivation guard being the only line of defence.
 * Real-path/symlink validation needs a project root and stays with the T3 tool broker
 * (`execution.md` §27).
 */
function assertScopePaths(method: string, value: unknown, field: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const scope = value as { readPaths?: unknown; writePaths?: unknown };
  const paths: string[] = [];
  for (const key of ['readPaths', 'writePaths'] as const) {
    const list = scope[key];
    if (!Array.isArray(list)) continue;
    for (const path of list) if (typeof path === 'string') paths.push(path);
  }
  const bad = paths.filter(
    (path) =>
      path.length === 0 ||
      path.startsWith('/') ||
      path.startsWith('~') ||
      /^[A-Za-z]:/u.test(path) ||
      path.includes('\0') ||
      path.split(/[\\/]+/u).includes('..'),
  );
  if (bad.length > 0) {
    throw new ProtocolError(
      'VALIDATION_ERROR',
      `${method} ${field} contains a path that is not repository-relative: ${bad.join(', ')}`,
      { details: { method, field, rejected: bad } },
    );
  }
}

/** The scope inside an assessment/spec/result body, when it has one. */
function scopeOf(value: JsonObject): JsonObject | undefined {
  const scope = value['scope'];
  return typeof scope === 'object' && scope !== null && !Array.isArray(scope) ? scope : undefined;
}

/** A body member that must be a non-empty string, or a protocol-shaped refusal. */
function requireString(body: JsonObject, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProtocolError('VALIDATION_ERROR', `${field} must be a non-empty string`, {
      details: { field },
    });
  }
  return value;
}

/**
 * Validates the capability and the Attempt it names.
 *
 * The order follows `gateway-http.ts`: token → Run → terminal Run → Attempt → Attempt state
 * → epoch. A capability that outlives its Attempt is revoked here rather than merely
 * refused, so a stale Runner process cannot keep calling.
 */
function authenticate(
  options: ControlEndpointOptions,
  token: string | undefined,
  response: ServerResponse,
  log: (line: string) => void,
): ControlCaller | undefined {
  const verdict = options.capabilities.verify(token);
  if (!verdict.ok) {
    refuse(response, log, statusForControlCode(verdict.code), verdict.code, verdict.message);
    return undefined;
  }
  const capability = verdict.capability;
  const run = options.store.runs.find(capability.runId);
  if (run === undefined) {
    refuse(response, log, 404, 'NOT_FOUND', `Run ${capability.runId} does not exist`);
    return undefined;
  }
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    options.capabilities.revoke(capability.attemptId);
    refuse(response, log, 409, 'INVALID_STATE', `Run ${run.id} is ${run.status}`);
    return undefined;
  }
  const attempt = options.store.attempts.find(capability.attemptId);
  if (attempt === undefined) {
    options.capabilities.revoke(capability.attemptId);
    refuse(response, log, 401, 'NOT_AUTHORIZED', `Attempt ${capability.attemptId} does not exist`);
    return undefined;
  }
  if (attempt.status !== 'starting' && attempt.status !== 'running') {
    options.capabilities.revoke(capability.attemptId);
    refuse(
      response,
      log,
      401,
      'NOT_AUTHORIZED',
      `Attempt ${capability.attemptId} is ${attempt.status}; its capability is no longer valid`,
    );
    return undefined;
  }
  if (attempt.ownerEpoch + 1 !== capability.epoch) {
    options.capabilities.revoke(capability.attemptId);
    refuse(
      response,
      log,
      401,
      'NOT_AUTHORIZED',
      `the capability epoch ${String(capability.epoch)} does not match Attempt ${capability.attemptId} (${String(attempt.ownerEpoch + 1)})`,
    );
    return undefined;
  }
  return {
    runId: run.id,
    attemptId: attempt.id,
    // The protocol's `epoch` is the Attempt's own epoch; the capability's generation was
    // already checked above (`ownerEpoch + 1`).
    epoch: attempt.ownerEpoch,
    role: capability.role,
  };
}

function parseBody(text: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProtocolError('VALIDATION_ERROR', 'the request body is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProtocolError('VALIDATION_ERROR', 'the request body must be an object');
  }
  return parsed as JsonObject;
}

/** The body's `operationId`, when the caller sent one (`protocol.md` §6 idempotency). */
function operationIdOf(body: JsonObject): string | undefined {
  const value = body['operationId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Starts the control endpoint. The caller owns the returned object (`close()` on shutdown).
 */
export async function createControlEndpoint(
  options: ControlEndpointOptions,
): Promise<ControlEndpoint> {
  const host = options.host ?? '127.0.0.1';
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const log = options.log ?? (() => undefined);

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (error instanceof PayloadTooLargeError) {
        log(`control-endpoint: refused 413 VALIDATION_ERROR: ${error.message}`);
        sendJson(response, 413, {
          error: { code: 'VALIDATION_ERROR', message: error.message },
        });
        return;
      }
      if (error instanceof ProtocolError) {
        refuse(response, log, statusForControlCode(error.code), error.code, error.message);
        return;
      }
      log(`control-endpoint: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(response, 500, {
        error: { code: 'INTERNAL_ERROR', message: 'the control endpoint failed' },
      });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, { ok: true });
      return;
    }
    const authorization = request.headers.authorization ?? '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;
    const caller = authenticate(options, token, response, log);
    if (caller === undefined) return;
    if (request.method !== 'POST') {
      refuse(response, log, 404, 'NOT_FOUND', url.pathname);
      return;
    }
    const body = parseBody(await readBody(request, maxBodyBytes));
    switch (url.pathname) {
      case CONTROL_PATHS.toolExecute: {
        // `tool.execute` (T3). Field validation, the inline/deferred result shapes and the
        // endpoint's own `tool.refused` audit live in `tool-http.ts`; this case owns only
        // the transport: the authenticated caller, the request body and the client-gone
        // signal that must kill a running tool's process group.
        if (options.toolExecute === undefined) {
          refuse(
            response,
            log,
            503,
            'PROVIDER_UNAVAILABLE',
            'this daemon has no tool handler configured; tool.execute cannot be served',
          );
          return;
        }
        // A client that disappears mid-call aborts the AbortSignal, which cancels the
        // tool's whole process group (`reliability.md` §6). `response.close` with
        // `writableFinished === false` is the "connection went away" case; a finished
        // response must not abort the call it already answered.
        const controller = new AbortController();
        const onResponseClose = (): void => {
          if (!response.writableFinished) controller.abort();
        };
        response.on('close', onResponseClose);
        try {
          const answer = await handleToolExecute(
            {
              store: options.store,
              handler: options.toolExecute,
              newToolOperationId: () => uuidv7(),
              log,
            },
            caller,
            body,
            controller.signal,
          );
          sendJson(response, answer.status, answer.body);
        } finally {
          response.removeListener('close', onResponseClose);
        }
        return;
      }
      case CONTROL_PATHS.permissionRequest: {
        // `permission.request` (T3): the Runner was refused and asks for a user decision.
        if (options.permissionRequest === undefined) {
          refuse(
            response,
            log,
            503,
            'PROVIDER_UNAVAILABLE',
            'this daemon has no permission handler configured; permission.request cannot be served',
          );
          return;
        }
        assertKnownFields('permission.request', body);
        const toolName = requireString(body, 'toolName');
        const args = body['args'];
        if (typeof args !== 'object' || args === null || Array.isArray(args)) {
          throw new ProtocolError('VALIDATION_ERROR', 'args must be an object');
        }
        const toolOperationId = requireString(body, 'toolOperationId');
        const inputHash = requireString(body, 'inputHash');
        const answer = options.permissionRequest.request({
          caller,
          toolName,
          args,
          toolOperationId,
          inputHash,
        });
        log(
          `control-endpoint: ${caller.runId} attempt ${caller.attemptId} permission.request ${toolName}`,
        );
        sendJson(response, 200, answer);
        return;
      }
      case CONTROL_PATHS.contextRequest: {
        if (options.handler.contextRequest === undefined) {
          refuse(
            response,
            log,
            503,
            'PROVIDER_UNAVAILABLE',
            'this daemon has no context.request handler configured',
          );
          return;
        }
        assertKnownFields('context.request', body);
        const workId = requireString(body, 'workId');
        const reason = requireString(body, 'reason');
        const requestedRefs = body['requestedRefs'];
        if (!Array.isArray(requestedRefs)) {
          throw new ProtocolError('VALIDATION_ERROR', 'requestedRefs must be an array');
        }
        const answer = options.handler.contextRequest({
          caller,
          workId,
          requestedRefs: requestedRefs.filter(
            (entry): entry is JsonObject =>
              typeof entry === 'object' && entry !== null && !Array.isArray(entry),
          ),
          reason,
        });
        log(`control-endpoint: ${caller.runId} attempt ${caller.attemptId} context.request`);
        sendJson(response, 200, answer);
        return;
      }
      case CONTROL_PATHS.agentRequestDispatch: {
        if (options.handler.agentRequestDispatch === undefined) {
          refuse(
            response,
            log,
            503,
            'PROVIDER_UNAVAILABLE',
            'this daemon has no agent.request_dispatch handler configured',
          );
          return;
        }
        assertKnownFields('agent.request_dispatch', body);
        const workId = requireString(body, 'workId');
        const reason = requireString(body, 'reason');
        const requestedRole = requireString(body, 'requestedRole');
        const goal = requireString(body, 'goal');
        const sourceRefs = body['sourceRefs'];
        if (!Array.isArray(sourceRefs)) {
          throw new ProtocolError('VALIDATION_ERROR', 'sourceRefs must be an array');
        }
        const answer = options.handler.agentRequestDispatch({
          caller,
          workId,
          reason,
          requestedRole,
          goal,
          sourceRefs: sourceRefs.filter(
            (entry): entry is JsonObject =>
              typeof entry === 'object' && entry !== null && !Array.isArray(entry),
          ),
        });
        log(
          `control-endpoint: ${caller.runId} attempt ${caller.attemptId} agent.request_dispatch ${requestedRole}`,
        );
        sendJson(response, 200, answer);
        return;
      }
      case CONTROL_PATHS.decisionRequest: {
        if (options.handler.decisionRequest === undefined) {
          refuse(
            response,
            log,
            503,
            'PROVIDER_UNAVAILABLE',
            'this daemon has no decision.request handler configured',
          );
          return;
        }
        assertKnownFields('decision.request', body);
        const workId = requireString(body, 'workId');
        const question = requireString(body, 'question');
        const choices = body['choices'];
        if (choices !== undefined && !Array.isArray(choices)) {
          throw new ProtocolError('VALIDATION_ERROR', 'choices must be an array of strings');
        }
        const answer = options.handler.decisionRequest({
          caller,
          workId,
          question,
          choices: (choices ?? []).map((entry) =>
            typeof entry === 'string' ? entry : JSON.stringify(entry),
          ),
        });
        log(`control-endpoint: ${caller.runId} attempt ${caller.attemptId} decision.request`);
        sendJson(response, 200, answer);
        return;
      }
      case CONTROL_PATHS.assessmentSubmit: {
        assertKnownFields('assessment.submit', body);
        const workId = requireString(body, 'workId');
        const assessment = body['assessment'];
        if (typeof assessment !== 'object' || assessment === null || Array.isArray(assessment)) {
          throw new ProtocolError('VALIDATION_ERROR', 'assessment must be an object');
        }
        const scope = scopeOf(assessment);
        if (scope !== undefined) assertScopePaths('assessment.submit', scope, 'assessment.scope');
        const operationId = operationIdOf(body);
        const expectedVersion = expectedVersionOf(body);
        const result = options.handler.assessmentSubmit({
          caller,
          workId,
          assessment,
          ...(operationId === undefined ? {} : { operationId }),
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        });
        options.noteSubmitted?.({
          runId: caller.runId,
          attemptId: caller.attemptId,
          method: 'assessment.submit',
        });
        log(`control-endpoint: ${caller.runId} attempt ${caller.attemptId} assessment.submit`);
        sendJson(response, 200, result);
        return;
      }
      case CONTROL_PATHS.agentDispatch: {
        assertKnownFields('agent.dispatch', body);
        const spec = body['spec'];
        if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
          throw new ProtocolError('VALIDATION_ERROR', 'spec must be an object');
        }
        const scope = scopeOf(spec);
        if (scope !== undefined) assertScopePaths('agent.dispatch', scope, 'spec.scope');
        const operationId = operationIdOf(body);
        const expectedVersion = expectedVersionOf(body);
        const result = options.handler.agentDispatch({
          caller,
          spec,
          ...(operationId === undefined ? {} : { operationId }),
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        });
        options.noteSubmitted?.({
          runId: caller.runId,
          attemptId: caller.attemptId,
          method: 'agent.dispatch',
        });
        log(`control-endpoint: ${caller.runId} attempt ${caller.attemptId} agent.dispatch`);
        sendJson(response, 200, result);
        return;
      }
      case CONTROL_PATHS.stageSubmit: {
        assertKnownFields('stage.submit', body);
        const result = body['result'];
        if (typeof result !== 'object' || result === null || Array.isArray(result)) {
          throw new ProtocolError('VALIDATION_ERROR', 'result must be an object');
        }
        const operationId = operationIdOf(body);
        const expectedVersion = expectedVersionOf(body);
        const submitted = options.handler.stageSubmit({
          caller,
          result,
          ...(operationId === undefined ? {} : { operationId }),
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        });
        // A Schema rejection is a *correctable* answer, not a delivery: only an accepted
        // submission satisfies the two-strike rule (`protocol.md` §6).
        if (submitted['accepted'] !== false) {
          options.noteSubmitted?.({
            runId: caller.runId,
            attemptId: caller.attemptId,
            method: 'stage.submit',
          });
        }
        const outcome = submitted['status'];
        log(
          `control-endpoint: ${caller.runId} attempt ${caller.attemptId} stage.submit ${
            typeof outcome === 'string' ? outcome : 'accepted'
          }`,
        );
        sendJson(response, 200, submitted);
        return;
      }
      default:
        refuse(response, log, 404, 'NOT_FOUND', url.pathname);
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;
  return {
    server,
    port,
    url: `http://${host}:${String(port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
