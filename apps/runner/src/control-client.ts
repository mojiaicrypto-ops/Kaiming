/**
 * The Runner's client for the Core control channel (`docs/architecture/protocol.md` §6).
 *
 * §6 is the internal Chief/Runner method surface: `assessment.submit`, `agent.dispatch`,
 * `stage.submit`. The Runner reaches it over the Core's loopback endpoint with its
 * Attempt capability — the same short-lived token it presents to the model gateway
 * (`execution.md` §2) — so the methods are callable only from inside this Attempt, only
 * while the Attempt is alive, and only for the Run the token was issued to.
 *
 * The tool definitions in `control-tools.ts` are the Pi-facing half; this module is the
 * transport and never decides what a complaint means. A refusal is reported to the model as
 * an error result (so it can correct and submit again) while the protocol code is preserved
 * for the Runner's own log.
 */
import type { Role } from '@agentdev/contracts';
import type { ReadLedger } from './read-ledger.js';
import type { PiToolSpec } from '@agentdev/pi-runtime';
import { Type } from 'typebox';

/** One attempt's binding to the control endpoint. */
export interface ControlClient {
  readonly url: string;
  readonly capability: string;
  readonly attemptId: string;
  readonly epoch: number;
  assessmentSubmit(input: { readonly workId: string; readonly assessment: unknown }): Promise<void>;
  agentDispatch(input: { readonly spec: unknown }): Promise<void>;
  stageSubmit(input: { readonly result: unknown }): Promise<void>;
  /**
   * `protocol.md` §6 `context.request` (T3 轮 3): append reads inside this Run's scope.
   *
   * Optional so a client built for an older surface keeps compiling; when it is absent the
   * matching Pi tool is not registered at all (a model must not be handed a tool whose
   * transport cannot answer).
   */
  contextRequest?(input: {
    readonly workId: string;
    readonly requestedRefs: readonly { readonly path: string; readonly reason?: string }[];
    readonly reason: string;
  }): Promise<unknown>;
  /**
   * `protocol.md` §6 `agent.request_dispatch` (T3 轮 3): ask the Chief for another role.
   *
   * The professional Run cannot create a grandchild Run, so the only possible answer is the
   * `chief_action_required` event (`rules/agents.md` §3).
   */
  agentRequestDispatch?(input: {
    readonly workId: string;
    readonly reason: string;
    readonly requestedRole: string;
    readonly goal: string;
    readonly sourceRefs: readonly {
      readonly kind: string;
      readonly id: string;
      readonly version: string;
    }[];
  }): Promise<unknown>;
  /**
   * `execution.md` §7 `decision_request` (T3 轮 3, Chief): ask the user a product question.
   *
   * The question becomes a `kind='decision'` Artifact the Decision's `targetRef` points at;
   * the answer arrives through the ordinary `decision.resolve`.
   */
  decisionRequest?(input: {
    readonly workId: string;
    readonly question: string;
    readonly choices: readonly string[];
  }): Promise<unknown>;
}

/** A control refusal, with the protocol code the endpoint answered (`protocol.md` §7). */
export class ControlError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ControlError';
    this.code = code;
    this.status = status;
  }
}

export interface ControlClientOptions {
  /** Base URL of the Core's control endpoint, e.g. `http://127.0.0.1:51234`. */
  readonly url: string;
  readonly capability: string;
  readonly attemptId: string;
  readonly epoch: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly log?: (line: string) => void;
}

/** How long one control call may take before the Runner gives up on it. */
export const CONTROL_TIMEOUT_MS = 30_000;

interface ControlResponse {
  readonly status: number;
  readonly body: unknown;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Creates one Attempt's control client.
 *
 * The `epoch` is sent with every call so a stale Runner cannot submit for a newer Attempt:
 * the endpoint re-checks it against the Attempt row even though the capability already
 * carries it (`execution.md` §2).
 */
export function createControlClient(options: ControlClientOptions): ControlClient {
  const doFetch = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.timeoutMs ?? CONTROL_TIMEOUT_MS;

  async function call(path: string, body: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${options.url}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.capability}`,
        },
        body: JSON.stringify({ attemptId: options.attemptId, epoch: options.epoch, ...body }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const parsed: ControlResponse = { status: response.status, body: await readJson(response) };
    if (!response.ok) {
      const error =
        typeof parsed.body === 'object' && parsed.body !== null
          ? ((parsed.body as { error?: { code?: unknown; message?: unknown } }).error ?? {})
          : {};
      const code = typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR';
      const message = typeof error.message === 'string' ? error.message : `HTTP ${response.status}`;
      throw new ControlError(response.status, code, message);
    }
    return parsed.body;
  }

  return {
    url: options.url,
    capability: options.capability,
    attemptId: options.attemptId,
    epoch: options.epoch,
    assessmentSubmit: async ({ workId, assessment }) => {
      log(`control: assessment.submit for Work ${workId}`);
      await call('/control/assessment.submit', { workId, assessment });
    },
    agentDispatch: async ({ spec }) => {
      log('control: agent.dispatch');
      await call('/control/agent.dispatch', { spec });
    },
    ...{
      contextRequest: async ({ workId, requestedRefs, reason }) => {
        log(`control: context.request for Work ${workId} (${String(requestedRefs.length)} refs)`);
        return call('/control/context.request', { workId, requestedRefs, reason });
      },
      agentRequestDispatch: async ({ workId, reason, requestedRole, goal, sourceRefs }) => {
        log(`control: agent.request_dispatch ${requestedRole}`);
        return call('/control/agent.request_dispatch', {
          workId,
          reason,
          requestedRole,
          goal,
          sourceRefs,
        });
      },
      decisionRequest: async ({ workId, question, choices }) => {
        log(`control: decision.request for Work ${workId}`);
        return call('/control/decision.request', { workId, question, choices });
      },
    },
    stageSubmit: async ({ result }) => {
      log(`control: stage.submit ${JSON.stringify(result).slice(0, 120)}`);
      const answer = await call('/control/stage.submit', { result });
      // `protocol.md` §6: a Schema rejection is a correctable result, not a delivery. The
      // tool must report an error so the model fixes it and the supervisor does not count
      // the attempt as compliant.
      if (typeof answer === 'object' && answer !== null) {
        const rejected = (answer as { accepted?: unknown }).accepted === false;
        if (rejected) {
          const body = answer as { code?: unknown; message?: unknown };
          throw new ControlError(
            200,
            typeof body.code === 'string' ? body.code : 'VALIDATION_ERROR',
            typeof body.message === 'string'
              ? body.message
              : 'the stage result was rejected; correct it and submit again',
          );
        }
      }
    },
  };
}

/**
 * Turns a control call whose answer matters into a Pi tool result.
 *
 * `context.request` returns content the model must read; `request_dispatch` /
 * `decision_request` return the id it should mention. The refusal path mirrors
 * `runControlTool`: the protocol code is preserved so the model can tell a correctable
 * `VALIDATION_ERROR` from a terminal `NOT_AUTHORIZED`.
 */
export async function runAnswerTool(
  call: () => Promise<unknown>,
  render: (answer: unknown) => string,
): Promise<{ text: string; isError?: boolean }> {
  try {
    return { text: render(await call()) };
  } catch (error) {
    if (error instanceof ControlError) {
      return { text: `${error.code}: ${error.message}`, isError: true };
    }
    return {
      text: `CONTROL_UNREACHABLE: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

/** A tool parameter read as text; a non-string becomes its JSON form, never "[object Object]". */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value) ?? '';
}

/** Turns a control call into a Pi tool result, preserving the protocol code. */
export async function runControlTool(
  call: () => Promise<void>,
  successText: string,
): Promise<{ text: string; isError?: boolean }> {
  try {
    await call();
    return { text: successText };
  } catch (error) {
    if (error instanceof ControlError) {
      return { text: `${error.code}: ${error.message}`, isError: true };
    }
    return {
      text: `CONTROL_UNREACHABLE: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

/**
 * The Pi tools one role's session registers (`execution.md` §7).
 *
 * "Chief有assessment_submit/agent_dispatch/decision_request；专业角色有stage_yield/
 * request_dispatch." `decision_request` and `request_dispatch` are not part of this slice's
 * contract channel (they are `decision.submit`/`agent.request_dispatch`, which the daemon
 * serves over `/rpc`), so they are not invented here.
 */
export interface ControlToolOptions {
  readonly client: ControlClient;
  /**
   * The role this Attempt runs as (`execution.md` §7).
   *
   * "Chief有assessment_submit/agent_dispatch/decision_request；专业角色有stage_yield/
   * request_dispatch" — the Chief's tools are not registered in a professional session at
   * all, so a prompt-injected model has nothing to call (the endpoint refuses anyway, but
   * the surface stays as narrow as the document).
   */
  readonly role: Role;
  /**
   * Called after an accepted `stage.submit`.
   *
   * The runner needs to know its turn delivered a structured result, because a plain-text
   * end is answered with one corrective prompt by the supervisor
   * (`protocol.md` §6).
   */
  readonly onStageSubmitted?: () => void;
  readonly onAssessmentSubmitted?: () => void;
  readonly onDispatchSubmitted?: () => void;
  /** The Work a Chief assessment must name; Core refuses a mismatching one anyway. */
  readonly workId?: string;
  /**
   * The Attempt's read ledger (`AC-085`).
   *
   * `stage_yield` writes its seal into the result, so `readLedgerSeq`/`readLedgerHash` come
   * from the reads that really happened — never from the model's arguments.
   */
  readonly readLedger?: Pick<ReadLedger, 'seal'>;
  /**
   * Core's authoritative read-ledger binding for this Attempt (`AC-085`).
   *
   * Preferred over `readLedger`: Core returns `ledger:{seq,hash}` on every `tool.execute`
   * response, so the seal follows the reads Core actually recorded.
   */
  readonly readLedgerBinding?: () => { readonly seq: number; readonly hash: string };
}

/**
 * Builds the role's control tools.
 *
 * These are hand-written parameter schemas rather than free text: the model fills the
 * documented fields (`assessment.submit` params, `ProfessionalDispatchSpec`,
 * `StageResult`), which is what makes a submission checkable instead of parsed out of an
 * answer.
 */
export function controlTools(options: ControlToolOptions): readonly PiToolSpec[] {
  const { client } = options;
  const stageResult: PiToolSpec = {
    name: 'stage_yield',
    label: 'Submit stage result',
    description:
      'Submit the structured result of this stage. Required: status (success/needs_input/failed), summary. ' +
      'Optional: artifactRefs, evidenceRefs, changedPaths, findingIds, unknowns, requestedActions. ' +
      'The Runner adds readLedgerSeq/readLedgerHash from the reads this Attempt actually ' +
      'performed (AC-085), so do not invent them. ' +
      'A stage is not complete until this tool is called; plain text does not deliver.',
    parameters: Type.Object({
      status: Type.Union([
        Type.Literal('success'),
        Type.Literal('needs_input'),
        Type.Literal('failed'),
      ]),
      summary: Type.String(),
      artifactRefs: Type.Optional(Type.Array(Type.String())),
      evidenceRefs: Type.Optional(Type.Array(Type.String())),
      changedPaths: Type.Optional(Type.Array(Type.String())),
      findingIds: Type.Optional(Type.Array(Type.String())),
      unknowns: Type.Optional(Type.Array(Type.String())),
      requestedActions: Type.Optional(Type.Array(Type.String())),
    }),
    execute: async (params) => {
      // The ledger binding is Runner/Core-owned: it overwrites anything the model sent, so
      // the seal always describes the reads that really happened (WP-12 R3-2d). Core's
      // per-call binding wins; the local seal (the empty genesis value until the tool
      // bridge records a read) is the initial value.
      const seal = options.readLedgerBinding?.() ?? options.readLedger?.seal();
      const result = await runControlTool(async () => {
        await client.stageSubmit({
          result: {
            ...params,
            ...(seal === undefined ? {} : { readLedgerSeq: seal.seq, readLedgerHash: seal.hash }),
          },
        });
      }, 'stage result submitted');
      if (result.isError !== true) options.onStageSubmitted?.();
      return result;
    },
  };

  const assessment: PiToolSpec = {
    name: 'assessment_submit',
    label: 'Submit routing assessment',
    description:
      'Submit the routing assessment for this Work (`docs/rules/workflow.md` §1/§2). ' +
      'Required: intent (assist/artifact/document/delivery/operation), goal, scope ' +
      '({readPaths,writePaths,operations,networkTargets}), level (none/L1/L2/L3), ' +
      'semanticImpact, riskFlags, uncertainties, policyRevision, reason. ' +
      'Operations bash/network/secret/push/deploy/delete_data are never part of a routed ' +
      'assessment; they require an explicit user grant.',
    parameters: Type.Object({
      intent: Type.Union([
        Type.Literal('assist'),
        Type.Literal('artifact'),
        Type.Literal('document'),
        Type.Literal('delivery'),
        Type.Literal('operation'),
      ]),
      goal: Type.String(),
      scope: Type.Object({
        readPaths: Type.Array(Type.String()),
        writePaths: Type.Array(Type.String()),
        operations: Type.Array(Type.String()),
        networkTargets: Type.Array(Type.String()),
      }),
      level: Type.Union([
        Type.Literal('none'),
        Type.Literal('L1'),
        Type.Literal('L2'),
        Type.Literal('L3'),
      ]),
      semanticImpact: Type.Boolean(),
      riskFlags: Type.Array(Type.String()),
      uncertainties: Type.Array(Type.String()),
      policyRevision: Type.Number(),
      reason: Type.String(),
    }),
    execute: async (params) => {
      const workId = options.workId;
      if (workId === undefined) {
        return { text: 'VALIDATION_ERROR: this Run has no Work to assess', isError: true };
      }
      const result = await runControlTool(async () => {
        await client.assessmentSubmit({ workId, assessment: params });
      }, 'assessment submitted');
      if (result.isError !== true) options.onAssessmentSubmitted?.();
      return result;
    },
  };

  const dispatch: PiToolSpec = {
    name: 'agent_dispatch',
    label: 'Dispatch a professional Run',
    description:
      'Dispatch one professional Run (`ProfessionalDispatchSpec`). Required: role, purpose, goal, ' +
      'scope, stage, contextSelection, requiredOutputs, requiredChild, joinPolicy, budgetAllocation. ' +
      'workId is taken from this Run; profileRevision and the parent Run are set by Core.',
    parameters: Type.Object({
      role: Type.String(),
      purpose: Type.String(),
      goal: Type.String(),
      scope: Type.Object({
        readPaths: Type.Array(Type.String()),
        writePaths: Type.Array(Type.String()),
        operations: Type.Array(Type.String()),
        networkTargets: Type.Array(Type.String()),
      }),
      stage: Type.String(),
      contextSelection: Type.Object({
        goal: Type.String(),
        sourceRefs: Type.Array(Type.Object({ kind: Type.String(), id: Type.String() })),
        reasonPerSource: Type.Record(Type.String(), Type.String()),
        featureRefs: Type.Optional(Type.Array(Type.String())),
        codePaths: Type.Optional(Type.Array(Type.String())),
        artifactRefs: Type.Optional(Type.Array(Type.String())),
        excluded: Type.Optional(Type.Array(Type.String())),
        unknowns: Type.Optional(Type.Array(Type.String())),
        readBudget: Type.Object({
          initialTokens: Type.Number(),
          expansionTokens: Type.Number(),
        }),
      }),
      requiredOutputs: Type.Array(Type.String()),
      requiredChild: Type.Boolean(),
      joinPolicy: Type.Union([Type.Literal('none'), Type.Literal('all')]),
      budgetAllocation: Type.Number(),
    }),
    execute: async (params) => {
      const result = await runControlTool(async () => {
        await client.agentDispatch({ spec: params });
      }, 'professional Run dispatched');
      if (result.isError !== true) options.onDispatchSubmitted?.();
      return result;
    },
  };

  /**
   * `context.request` (T3 轮 3): every role may append reads inside its own ACL scope.
   *
   * The result text carries the returned content verbatim (plus the ledger binding), because
   * the whole point of the call is to put authorized evidence in the model's context.
   */
  const contextRequestTool: PiToolSpec | undefined =
    client.contextRequest === undefined
      ? undefined
      : {
          name: 'context_request',
          label: 'Request more context',
          description:
            "Read additional repository files inside this Run's authorized scope. Each ref is a " +
            'path (optionally with a reason). Content is returned only for refs the Run may read; ' +
            'a ref outside the scope is recorded and escalated to the Chief, which may widen the ' +
            'scope. Every admitted read is appended to this Attempt ledger (AC-085).',
          parameters: Type.Object({
            requestedRefs: Type.Array(
              Type.Object({ path: Type.String(), reason: Type.Optional(Type.String()) }),
            ),
            reason: Type.String(),
          }),
          execute: async (params) => {
            if (options.workId === undefined) {
              return { text: 'VALIDATION_ERROR: this Run has no Work', isError: true };
            }
            return runAnswerTool(
              () =>
                client.contextRequest?.({
                  workId: options.workId ?? '',
                  requestedRefs: (params['requestedRefs'] ?? []) as {
                    path: string;
                    reason?: string;
                  }[],
                  reason: textOf(params['reason']),
                }) ?? Promise.resolve(undefined),
              (answer) => JSON.stringify(answer ?? null),
            );
          },
        };

  /**
   * `request_dispatch` (T3 轮 3): a professional Run asks the Chief for another role.
   *
   * It never creates a Run: the call produces the `chief_action_required` event the Chief
   * acts on (`rules/agents.md` §3 "专业Agent提交request_dispatch只形成Chief待处理事件").
   */
  const requestDispatchTool: PiToolSpec | undefined =
    client.agentRequestDispatch === undefined
      ? undefined
      : {
          name: 'request_dispatch',
          label: 'Request another role',
          description:
            'Ask the Chief to dispatch another role (for example a review or a backend fix). ' +
            'Required: reason, requestedRole, goal. Optional: sourceRefs. This creates a pending ' +
            'Chief action; it does not create the Run itself.',
          parameters: Type.Object({
            reason: Type.String(),
            requestedRole: Type.String(),
            goal: Type.String(),
            sourceRefs: Type.Optional(
              Type.Array(
                Type.Object({
                  kind: Type.String(),
                  id: Type.String(),
                  version: Type.String(),
                }),
              ),
            ),
          }),
          execute: async (params) => {
            if (options.workId === undefined) {
              return { text: 'VALIDATION_ERROR: this Run has no Work', isError: true };
            }
            return runAnswerTool(
              () =>
                client.agentRequestDispatch?.({
                  workId: options.workId ?? '',
                  reason: textOf(params['reason']),
                  requestedRole: textOf(params['requestedRole']),
                  goal: textOf(params['goal']),
                  sourceRefs: (params['sourceRefs'] ?? []) as {
                    kind: string;
                    id: string;
                    version: string;
                  }[],
                }) ?? Promise.resolve(undefined),
              (answer) =>
                `the Chief has been asked to dispatch the requested role: ${JSON.stringify(answer ?? null)}`,
            );
          },
        };

  /**
   * `decision_request` (T3 轮 3, Chief): ask the user a product question.
   *
   * The question becomes a decision artifact the user sees in the Inbox; the answer arrives
   * as a resolved Decision, so the Chief learns it through the ordinary decision flow.
   */
  const decisionRequestTool: PiToolSpec | undefined =
    client.decisionRequest === undefined
      ? undefined
      : {
          name: 'decision_request',
          label: 'Ask the user a product question',
          description:
            'Ask the user to decide a product question that blocks this Work. Required: question ' +
            '(the full text the user must answer). Optional: choices (defaults to accept/reject). ' +
            'The question is stored as a decision artifact and appears in the Inbox; the user ' +
            'answers with decision.resolve, which closes the decision.',
          parameters: Type.Object({
            question: Type.String(),
            choices: Type.Optional(Type.Array(Type.String())),
          }),
          execute: async (params) => {
            if (options.workId === undefined) {
              return { text: 'VALIDATION_ERROR: this Run has no Work to ask about', isError: true };
            }
            return runAnswerTool(
              () =>
                client.decisionRequest?.({
                  workId: options.workId ?? '',
                  question: textOf(params['question']),
                  choices: (params['choices'] ?? []) as string[],
                }) ?? Promise.resolve(undefined),
              (answer) =>
                `the user has been asked; the decision is pending: ${JSON.stringify(answer ?? null)}`,
            );
          },
        };

  // Only the documented set for this role (`execution.md` §7): the Chief assesses, dispatches
  // and asks the user; a professional Run delivers a stage result and may request another role;
  // every role may request more context. A tool whose transport is missing is not registered.
  const shared = [contextRequestTool].filter((tool): tool is PiToolSpec => tool !== undefined);
  return options.role === 'chief'
    ? [assessment, dispatch, decisionRequestTool, ...shared].filter(
        (tool): tool is PiToolSpec => tool !== undefined,
      )
    : [stageResult, requestDispatchTool, ...shared].filter(
        (tool): tool is PiToolSpec => tool !== undefined,
      );
}
