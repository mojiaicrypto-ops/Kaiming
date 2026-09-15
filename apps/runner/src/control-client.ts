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
import {
  missingSelectionReasons,
  professionalDispatchSpecSchema,
  stageResultContentSchema,
  type Role,
} from '@agentdev/contracts';
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
  /**
   * The Attempt's read-ledger binding as the **control channel** last reported it.
   *
   * `context.request` expands the ledger over this channel, not over the tool bridge, and Core
   * answers with the new binding (`control-handler` `context.request` → `ledger:{seq,hash}`).
   * A `stage_yield` that reported the tool bridge's stale value was refused
   * `STALE_ARTIFACT: the stage result is bound to read 0 but the ledger ends at 6 (AC-085)`
   * for the rest of the Run — the delivery was impossible, not merely wrong (WP-12
   * T2-fix-delivery). `attempt.ts` composes this with the bridge's binding by the higher
   * `seq`, so whichever channel read last is what the seal reports.
   */
  ledgerBinding?(): { readonly seq: number; readonly hash: string } | undefined;
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

/** Reads a `ledger:{seq,hash}` member off the wire, ignoring anything malformed. */
function readLedgerOf(value: unknown): { readonly seq: number; readonly hash: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const seq = (value as { seq?: unknown }).seq;
  const hash = (value as { hash?: unknown }).hash;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return undefined;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) return undefined;
  return { seq, hash };
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
  /** The binding the control channel last reported; `undefined` until an expansion answer. */
  let currentLedger: { readonly seq: number; readonly hash: string } | undefined;

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
    // The last binding the control channel reported (`context.request`); `undefined` until an
    // answer carries one, so the caller can tell "no control read yet" from "read nothing".
    ledgerBinding: () => currentLedger,
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
        const answer = await call('/control/context.request', { workId, requestedRefs, reason });
        // Core answers with the Attempt's binding *after* the expansion; keeping it is what
        // lets a later `stage_yield` report the ledger Core actually holds (AC-085).
        const ledger = readLedgerOf(
          typeof answer === 'object' && answer !== null
            ? (answer as { ledger?: unknown }).ledger
            : undefined,
        );
        if (ledger !== undefined) currentLedger = ledger;
        return answer;
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
/**
 * Entity ids inside a StageResult are ids of **existing rows** (`data.md` §1), not paths.
 *
 * A model naturally writes the evidence it has — a file path, a revision, a sentence — into
 * `evidenceRefs`, and Core's `stageResultContentSchema` refuses anything that is not a
 * lowercase UUIDv7 (or the 32-hex Project id). That refusal used to be the model's first
 * sight of the rule, and a second one ended the Run as `contract_violation`
 * (`docs/rules/agents.md` §4), so the tool states the shape and checks it first.
 */
const ENTITY_ID_DESCRIPTION =
  'the id of an existing row (lowercase UUIDv7, or the 32-hex Project id) — never a path, ' +
  'a file name, a revision or prose';

/** The fields `stage_yield` accepts; `readLedgerSeq`/`readLedgerHash` are Runner-owned. */
const STAGE_YIELD_FIELDS = [
  'status',
  'summary',
  'artifactRefs',
  'evidenceRefs',
  'changedPaths',
  'findingIds',
  'unknowns',
  'requestedActions',
  'readLedgerSeq',
  'readLedgerHash',
] as const;

/** The list fields Core requires on every StageResult, as empty arrays when unset. */
const STAGE_RESULT_LISTS = [
  'artifactRefs',
  'evidenceRefs',
  'changedPaths',
  'findingIds',
  'unknowns',
  'requestedActions',
] as const;

/** One Zod issue as `<path>: <message>`, the same rendering `StageGate` uses. */
function stageIssue(issue: { readonly path: PropertyKey[]; readonly message: string }): string {
  return `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`;
}

/**
 * Builds the payload Core will receive, or the exact reason it would be refused.
 *
 * The check uses the **same** `stageResultContentSchema` Core validates against, so the
 * tool can never accept a payload Core would reject, and Core still re-validates
 * independently (`packages/core/src/stage.ts`). Nothing about the two-strike rule changes:
 * the tool simply refuses to spend a strike on a shape the model can be told to fix.
 */
function buildStagePayload(
  params: Record<string, unknown>,
  seal: { readonly seq: number; readonly hash: string } | undefined,
):
  | { readonly ok: true; readonly payload: Record<string, unknown> }
  | { readonly ok: false; readonly message: string } {
  const unknown = Object.keys(params).filter(
    (key) => !(STAGE_YIELD_FIELDS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `unknown field(s) ${unknown.join(', ')}; stage_yield accepts ${STAGE_YIELD_FIELDS.join(', ')}`,
    };
  }
  if (seal === undefined) {
    return {
      ok: false,
      message:
        'this Attempt has no read-ledger seal, so stage_yield cannot submit; readLedgerSeq/readLedgerHash are Runner-owned and must not be invented',
    };
  }
  const payload: Record<string, unknown> = {
    status: params['status'],
    summary: params['summary'],
    readLedgerSeq: seal.seq,
    readLedgerHash: seal.hash,
  };
  for (const field of STAGE_RESULT_LISTS) payload[field] = params[field] ?? [];
  const parsed = stageResultContentSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map(stageIssue).join('; ') };
  }
  return { ok: true, payload: { ...parsed.data } };
}

/**
 * The professional roles `agent.dispatch` accepts, and the purposes Core documents.
 *
 * `rules/agents.md` §1 fixes the roles and §3 the purposes. The tool used to declare both as
 * free strings, so a real Chief model sent `role: "planner"` and Core refused the whole
 * dispatch with a Zod dump (WP-12 T2-fix-delivery); naming the vocabulary here lets the model
 * choose correctly and lets the tool refuse a typo before it reaches Core.
 */
const PROFESSIONAL_ROLES = [
  'product',
  'planning',
  'backend',
  'frontend',
  'review',
  'test',
  'settlement',
] as const;

const DISPATCH_PURPOSES = [
  'analysis',
  'artifact',
  'implementation',
  'review',
  'test',
  'settlement',
  'initialize',
  'document',
  'document_check',
  'operation',
] as const;

/**
 * Core-owned spec fields, injected by `Orchestrator.parseDraft` before it parses the draft
 * (`packages/core/src/orchestrator.ts`). The local draft check fills them with a valid
 * placeholder and ignores issues that name them.
 */
const PLACEHOLDER_ID = '00000000-0000-7000-8000-000000000000';

const INJECTED_DISPATCH_FIELDS: ReadonlySet<string> = new Set([
  'kind',
  'workId',
  'profileRevision',
  'parentRunId',
]);

/**
 * Every canonical stage a professional Run may carry, per role.
 *
 * Mirrors `ROLE_STAGES` (`packages/core/src/context/acl.ts`), and the test in
 * `control-client.test.ts` pins it to that vocabulary. It matters because the read ledger
 * opens a Run's scope from `(role, stage)` (`packages/core/src/read-ledger.ts` `scopeFor`):
 * a stage outside this table leaves the Attempt **degraded**, and then *every* `stage.submit`
 * is refused with `MISSING_CONTEXT` for the rest of the Run — which is exactly what a real
 * Chief produced by dispatching `stage: "implement"` (WP-12 T2-fix-delivery).
 */
const ROLE_STAGES: Readonly<Record<string, readonly string[]>> = {
  product: ['product', 'document', 'document_check'],
  planning: ['planning', 'document'],
  backend: ['develop-L1', 'develop-L2', 'develop-L3'],
  frontend: ['develop-L1', 'develop-L2', 'develop-L3'],
  review: ['document_check', 'review'],
  test: ['test'],
  settlement: ['settlement'],
};

/** The stage spelling per role, for the tool description and its local refusal. */
const STAGE_MAP_FOR_DESCRIPTION =
  'product → product/document/document_check; planning → planning/document; ' +
  'backend and frontend → develop-L1/develop-L2/develop-L3; review → review/document_check; ' +
  'test → test; settlement → settlement';

/**
 * The runtime spellings Core's own context layer normalizes (`normalizeContextStage`).
 *
 * Accepted here so a scripted caller that still says `develop` keeps working **and** gets a
 * canonical Run (`develop` used to leave the same degraded ledger as `implement`).
 */
const STAGE_ALIASES: Readonly<Record<string, string>> = {
  plan: 'planning',
  develop: 'develop-L2',
  develop_l1: 'develop-L1',
  develop_l2: 'develop-L2',
  develop_l3: 'develop-L3',
  implementation: 'develop-L2',
  code_review: 'review',
  document_review: 'document_check',
};

/**
 * Canonicalizes a dispatch's `stage` for its role, or explains the legal values.
 *
 * `scopeFor` looks the pair up verbatim, so the canonical spelling is what makes the Run's
 * read ledger openable. Core stays the authority on the dispatch itself.
 */
function canonicalStageFor(
  role: string,
  stage: unknown,
):
  { readonly ok: true; readonly stage: string } | { readonly ok: false; readonly message: string } {
  const legal = ROLE_STAGES[role] ?? [];
  const raw = typeof stage === 'string' ? stage.trim() : '';
  const lowered = raw.toLowerCase();
  const canonical =
    legal.find((entry) => entry.toLowerCase() === lowered) ?? STAGE_ALIASES[lowered] ?? '';
  if (canonical === '' || !legal.includes(canonical)) {
    return {
      ok: false,
      message: `stage "${raw}" is not a legal stage for a ${role} Run; use one of ${legal.join(', ')}`,
    };
  }
  return { ok: true, stage: canonical };
}

export function controlTools(options: ControlToolOptions): readonly PiToolSpec[] {
  const { client } = options;
  const stageResult: PiToolSpec = {
    name: 'stage_yield',
    label: 'Submit stage result',
    description:
      'Deliver the result of this stage. Call it exactly once, after you have done the work ' +
      'with your other tools. Required: status (success/needs_input/failed) and a non-empty ' +
      'summary of what you did, or of why you could not do it. Optional: artifactRefs ' +
      '({id, version, hash} pins of existing artifacts), evidenceRefs (ids of the existing ' +
      'rows you relied on), changedPaths (repository-relative paths you changed), findingIds ' +
      '(ids of existing Findings), unknowns, requestedActions. Every id field takes ' +
      `${ENTITY_ID_DESCRIPTION}; omit a list (or pass []) when you have nothing to put in it. ` +
      'The Runner adds readLedgerSeq/readLedgerHash from the reads this Attempt really ' +
      'performed (AC-085), so do not invent them. A stage is not delivered until this call ' +
      'is accepted: plain text does not deliver, and `request_dispatch` does not deliver for ' +
      'you — if you ask the Chief for another role you must still call this tool.',
    parameters: Type.Object({
      status: Type.Union([
        Type.Literal('success'),
        Type.Literal('needs_input'),
        Type.Literal('failed'),
      ]),
      summary: Type.String({ minLength: 1 }),
      artifactRefs: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.String({ minLength: 1 }),
            version: Type.Integer({ minimum: 1 }),
            hash: Type.String({ minLength: 1 }),
          }),
        ),
      ),
      evidenceRefs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      changedPaths: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      findingIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      unknowns: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      requestedActions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    }),
    execute: async (params) => {
      // The ledger binding is Runner/Core-owned: it overwrites anything the model sent, so
      // the seal always describes the reads that really happened (WP-12 R3-2d). Core's
      // per-call binding wins; the local seal (the empty genesis value until the tool
      // bridge records a read) is the initial value.
      const seal = options.readLedgerBinding?.() ?? options.readLedger?.seal();
      const built = buildStagePayload(params, seal);
      if (!built.ok) {
        // A local refusal keeps the protocol code the model already knows and never reaches
        // Core, so it consumes no Schema strike (`protocol.md` §6, `rules/agents.md` §4).
        return {
          text: `VALIDATION_ERROR: the stage result does not match the documented StageResult schema — ${built.message}`,
          isError: true,
        };
      }
      const result = await runControlTool(async () => {
        await client.stageSubmit({ result: built.payload });
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
      'scope.operations may only name the documented operations ' +
      '(read/search/artifact_write/edit/write/bash/git/network/secret/push/deploy/delete_data); ' +
      'riskFlags may only name the documented terms ' +
      '(identityOrPermission, secrets, securityBoundary, dataDeletionOrMigration, payment, ' +
      'publicProtocolBreak, deployOrRelease, gateRuleChange) — an unrecognized flag is read as ' +
      '"no risk" and refused by Core. ' +
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
      'workId is taken from this Run; profileRevision and the parent Run are set by Core. ' +
      `role must be one of ${PROFESSIONAL_ROLES.join('/')}; purpose must be one of ` +
      `${DISPATCH_PURPOSES.join('/')}. stage must be the canonical stage of that role ` +
      `(${STAGE_MAP_FOR_DESCRIPTION}) — a stage outside the role's list leaves the Run with no ` +
      'readable context, so it can never deliver a stage result.',
    parameters: Type.Object({
      role: Type.Union([
        Type.Literal('product'),
        Type.Literal('planning'),
        Type.Literal('backend'),
        Type.Literal('frontend'),
        Type.Literal('review'),
        Type.Literal('test'),
        Type.Literal('settlement'),
      ]),
      purpose: Type.Union([
        Type.Literal('analysis'),
        Type.Literal('artifact'),
        Type.Literal('implementation'),
        Type.Literal('review'),
        Type.Literal('test'),
        Type.Literal('settlement'),
        Type.Literal('initialize'),
        Type.Literal('document'),
        Type.Literal('document_check'),
        Type.Literal('operation'),
      ]),
      goal: Type.String(),
      scope: Type.Object({
        readPaths: Type.Array(Type.String()),
        writePaths: Type.Array(Type.String()),
        operations: Type.Array(
          Type.Union([
            Type.Literal('read'),
            Type.Literal('search'),
            Type.Literal('artifact_write'),
            Type.Literal('edit'),
            Type.Literal('write'),
            Type.Literal('bash'),
            Type.Literal('git'),
            Type.Literal('network'),
            Type.Literal('secret'),
            Type.Literal('push'),
            Type.Literal('deploy'),
            Type.Literal('delete_data'),
          ]),
        ),
        networkTargets: Type.Array(Type.String()),
      }),
      // A plain string, not a literal union: the Pi runtime validates arguments against this
      // schema *before* `execute`, so an enum would reject the documented runtime spellings
      // (`develop`) that `canonicalStageFor` normalizes — the offline model stub drives
      // `scripts/e2e.mjs` with exactly that value. The canonical vocabulary is stated in the
      // description and enforced (with the alias table) by `canonicalStageFor`.
      stage: Type.String(),
      contextSelection: Type.Object({
        goal: Type.String(),
        // Every `sourceRefs` entry needs a reason, keyed `"<kind>:<id>"` in
        // `reasonPerSource`, and `version` is part of the pin (`data.md` §3).
        sourceRefs: Type.Array(
          Type.Object({
            kind: Type.Union([
              Type.Literal('git'),
              Type.Literal('artifact'),
              Type.Literal('message'),
              Type.Literal('action'),
              Type.Literal('decision'),
              Type.Literal('policy'),
            ]),
            id: Type.String(),
            version: Type.String(),
            path: Type.Optional(Type.String()),
            hash: Type.Optional(Type.String()),
          }),
        ),
        reasonPerSource: Type.Record(Type.String(), Type.String()),
        featureRefs: Type.Array(Type.String()),
        codePaths: Type.Array(Type.String()),
        artifactRefs: Type.Array(
          Type.Object({
            id: Type.String(),
            version: Type.Integer({ minimum: 1 }),
            hash: Type.String(),
          }),
        ),
        excluded: Type.Array(Type.String()),
        unknowns: Type.Array(Type.String()),
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
      // The vocabulary is checked before Core sees the spec: a typo used to produce either a
      // verbose Zod dump (`role: "planner"`) or — for a legal role with a non-canonical stage
      // (`stage: "implement"`) — a Run that accepts no reads and can never deliver. Both are
      // correctable locally, so the model is told the legal values instead of guessing.
      const role = textOf(params['role']);
      if (!(PROFESSIONAL_ROLES as readonly string[]).includes(role)) {
        return {
          text: `VALIDATION_ERROR: ${role === '' ? 'role is missing' : `role "${role}" is not a professional role`}; use one of ${PROFESSIONAL_ROLES.join(', ')}`,
          isError: true,
        };
      }
      const purpose = textOf(params['purpose']);
      if (!(DISPATCH_PURPOSES as readonly string[]).includes(purpose)) {
        return {
          text: `VALIDATION_ERROR: ${purpose === '' ? 'purpose is missing' : `purpose "${purpose}" is not documented`}; use one of ${DISPATCH_PURPOSES.join(', ')}`,
          isError: true,
        };
      }
      const stage = canonicalStageFor(role, params['stage']);
      if (!stage.ok) {
        return { text: `VALIDATION_ERROR: ${stage.message}`, isError: true };
      }
      const spec = { ...params, role, purpose, stage: stage.stage };
      // The rest of the draft is checked with Core's own schema, exactly as
      // `Orchestrator.parseDraft` injects the Core-owned fields and parses it
      // (`packages/core/src/orchestrator.ts`). Core re-validates the real call; this only
      // turns its Zod dump into a precise, correctable tool error.
      const draft = professionalDispatchSpecSchema.safeParse({
        ...spec,
        kind: 'professional',
        workId: PLACEHOLDER_ID,
        profileRevision: 0,
        parentRunId: PLACEHOLDER_ID,
      });
      if (!draft.success) {
        const issues = draft.error.issues
          .filter((issue) => !INJECTED_DISPATCH_FIELDS.has(String(issue.path[0])))
          .map((issue) => stageIssue(issue));
        if (issues.length > 0) {
          return {
            text: `VALIDATION_ERROR: the dispatch spec is invalid — ${issues.join('; ')}`,
            isError: true,
          };
        }
      } else {
        // `data.md` §3: every selected source needs its written reason, keyed
        // `"<kind>:<id>"`. Core refuses a draft without one (`MISSING_CONTEXT`) and the schema
        // cannot express it, so the tool checks it here too.
        const missing = missingSelectionReasons(draft.data.contextSelection);
        if (missing.length > 0) {
          return {
            text: `VALIDATION_ERROR: every sourceRef needs a reasonPerSource entry; missing: ${missing.join(', ')}`,
            isError: true,
          };
        }
      }
      const result = await runControlTool(async () => {
        await client.agentDispatch({ spec });
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
            'Required: reason, requestedRole (one of product/planning/backend/frontend/review/' +
            'test/settlement), goal. Optional: sourceRefs. This creates a pending Chief action; ' +
            'it does not create the Run itself. Use it only when the work genuinely needs a ' +
            'different role: it does not deliver your stage and does not end your Run — after ' +
            'requesting a dispatch you must still call `stage_yield` for the stage you own.',
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
