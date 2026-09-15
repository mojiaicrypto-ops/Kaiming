/**
 * Building a Runner invocation from a Run's frozen state (WP-11 A2-T6).
 *
 * `execution.md` §2: a Run's provider, model and role come from its *frozen* configuration
 * snapshot; the prompt comes from the frozen dispatch. This module turns those facts into
 * the arguments the Runner process needs, and writes the per-Attempt model catalog that
 * points the Pi session at the Core's gateway.
 *
 * Known limits of this slice, stated rather than hidden:
 *
 * - the working directory is the project root; per-Task worktrees arrive with the
 *   tool-execution slice, and the write barrier already prevents a live Attempt from
 *   being replaced;
 * - the prompt is the Work goal plus the role/stage contract. Full ContextBuilder assembly
 *   (selected sources, read ledger, budgets) is the next slice;
 * - the Pi session is started tool-free (`apps/runner`'s `BUILTIN_TOOLS` is still empty),
 *   so this slice proves the execution and model path, not tool bridging.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { JsonObject, Role } from '@agentdev/contracts';
import { contextSelectionSchema } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';
import {
  buildContext,
  type ArtifactService,
  type AttemptCapabilityStore,
  type ConfigStore,
  type ContextInputKey,
  type ContextStage,
  type SnapshotWriter,
} from '@agentdev/core';
import type { PrepareRun, PrepareRunInput, RunnerInvocation } from '@agentdev/core';

import { createContextAssembly, type ContextGitReader } from './context-ports.js';
import { writeAttemptCatalog } from './runner-spawn.js';

export interface PrepareRunOptions {
  readonly store: ProjectStore;
  readonly config: ConfigStore;
  readonly capabilities: AttemptCapabilityStore;
  /** Base URL of the Core's model gateway (`createModelGatewayProxy`). */
  readonly gatewayUrl: string;
  /**
   * Base URL of the Core control endpoint (`protocol.md` §6).
   *
   * The Runner registers its role's control tools against this URL, so the Chief can submit
   * an assessment and a professional Run can submit a stage result; without it the Attempt
   * has no way to deliver anything but text.
   */
  readonly controlUrl?: string;
  /** Project root used as the working directory for this slice. */
  readonly projectRoot: string;
  /** Directory holding per-Attempt state (catalog, agent dir). */
  readonly attemptsDir: string;
  readonly log?: (line: string) => void;
  /**
   * The real Context ports (`context.md` §1).
   *
   * When all of them are present, the Attempt's prompt is built from a **real**
   * `buildContext` assembly over the Project's policy, role contract, Git blobs and
   * artifacts, and the frozen `ContextSnapshot` is persisted; when any is absent the
   * goal+contract prompt is kept, so a stack that predates the Context plane still
   * executes.
   */
  readonly artifacts?: ArtifactService;
  readonly gitReader?: ContextGitReader;
  readonly snapshots?: SnapshotWriter;
  readonly readMessageBody?: (relativeBlobPath: string) => string | null;
  /** Project data directory; snapshot directories land under `<snapshotRoot>/snapshots`. */
  readonly snapshotRoot?: string;
  readonly projectId?: string;
}

/**
 * Builds the prompt for one Attempt from the Work the Run belongs to.
 *
 * The tool sentence is role-specific on purpose: a Chief Run delivers through
 * `assessment_submit`/`agent_dispatch` and a professional Run through `stage_yield`
 * (`execution.md` §7), and a model that does not know that ends its turn with plain text —
 * which the two-strike rule then answers with a corrective prompt (WP-12 R3-2b).
 *
 * The professional sentence names the three duties in order, because getting any one of them
 * wrong ends the Run as `contract_violation` rather than delivering: do the work with the
 * role's tools, deliver through `stage_yield` with the documented fields, and ask for another
 * role only when the work really needs one — a `request_dispatch` does not discharge the
 * delivery itself (WP-12 T2-fix-delivery).
 */
export function roleContractSentence(role: Role): string {
  return role === 'chief'
    ? [
        'Deliver through your tools: call `assessment_submit` with the routing assessment',
        '(intent, goal, scope, level, semanticImpact, riskFlags, uncertainties, policyRevision,',
        'reason), then call `agent_dispatch` with the professional Run you decide on.',
        'Use only the documented role, purpose and risk-flag terms; a dispatch whose `stage` is',
        'not the canonical stage of that role (product→product/document/document_check;',
        'planning→planning/document; backend|frontend→develop-L1/develop-L2/develop-L3;',
        'review→review/document_check; test→test; settlement→settlement) leaves the Run with no',
        'readable context and it can never deliver.',
        // `workflow.md` §3: the L2/L3 code route is Product→Plan→Develop→…, and the develop
        // Run's Task/Grant only exist after the Plan gate approved a Plan (`plan.approve`
        // materialises the Task rows and queues the develop Run). A Chief that dispatches
        // the implementer first therefore buys a Run that can only report a blocker, so the
        // route order is stated here and enforced by Core (`orchestrator.enforceRouteOrder`).
        'Route order is not optional for an L2/L3 code delivery: dispatch `planning` first',
        '(and `product` before it when the requested behaviour is not yet defined), and never',
        'dispatch backend|frontend at a develop stage before an approved Plan exists — the',
        'develop Run obtains its Task and file Grants from the approved Plan, and Core queues',
        'that Run itself when the Plan gate approves the Plan. Dispatch each stage with',
        "`requiredChild: true` and `joinPolicy: 'all'` so your Run is woken when the stage",
        "settles and can trigger the next one; a `joinPolicy: 'none'` dispatch lets your Run",
        'end and leaves an approved Plan with no Chief left to hand the develop Run to.',
        'Plain text does not change the domain state.',
      ].join(' ')
    : [
        'Do this stage yourself with your tools, then deliver it by calling `stage_yield`',
        'exactly once. Required: status (success/needs_input/failed) and a non-empty summary;',
        'artifactRefs are {id,version,hash} pins, evidenceRefs/findingIds are ids of existing',
        'rows, changedPaths are repository-relative paths, plus unknowns and requestedActions.',
        'Omit a list (or pass []) when you have nothing to put in it. `stage_yield` is the only',
        'delivery: a prose summary and a `request_dispatch` call do not discharge this stage —',
        'use `request_dispatch` only when the work genuinely needs a different role, and call',
        '`stage_yield` yourself afterwards even then. `status=failed` or `needs_input` with the',
        'reason is an honest, valid delivery when the work is blocked.',
        // The Product/Plan stages run before any Task exists, so their file tools carry no
        // Grant yet (`grants.ts` mints run-scope Grants only for a role the Plan already
        // tasked). The context channel is the documented way to read in those stages
        // (`context.md` §1), and without this sentence a planning Run reports a blocker
        // instead of planning.
        'Your file tools only carry a Grant after an approved Plan tasked your role; in the',
        'Product and Plan stages read the sources you need through `context.request` instead,',
        'and still deliver the stage result with your real conclusion. In those stages your',
        'deliverable is the Product definition or the Plan, not the code change itself — the',
        'develop stages implement it, so not being able to write source files is not a blocker',
        'for planning.',
      ].join(' ');
}

/**
 * The stage goal the Chief dispatched this Run for (`data.md` §3 `DispatchSpec.goal`).
 *
 * The Work goal is the user's whole request; a professional Run still needs to know
 * *its own* stage's deliverable. Without it a real Planning model reads the Work goal
 * ("change `cancel()`…") as its own job, tries to write the source file, and reports a
 * blocker because the Product/Plan stages hold no file Grant (WP-12 W4).
 */
function stageGoalOf(input: PrepareRunInput, store: ProjectStore): string | undefined {
  const snapshot = store.snapshots.list({
    where: "type = 'dispatch' AND hash = ?",
    params: [input.run.dispatchSnapshotId],
  })[0];
  const spec = snapshot?.payload['dispatchSpec'];
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return undefined;
  const goal = (spec as Record<string, unknown>)['goal'];
  return typeof goal === 'string' && goal.trim() !== '' ? goal : undefined;
}

function promptFor(input: PrepareRunInput, store: ProjectStore): string {
  const work = store.works.find(input.run.workId);
  const goal = work?.goal ?? 'the assigned task';
  const stageGoal = stageGoalOf(input, store);
  return [
    `You are the AgentDev ${input.run.role} agent.`,
    `Stage: ${input.run.stage}. Purpose: ${input.run.purpose}.`,
    `Work goal: ${goal}`,
    ...(stageGoal === undefined || stageGoal === goal ? [] : [`Your stage goal: ${stageGoal}`]),
    roleContractSentence(input.run.role),
  ].join('\n');
}

interface AssembledContext {
  readonly prompt: string;
  readonly snapshotRef: string;
  readonly directory: string;
}

/**
 * Assembles the Attempt's real context (`context.md` §1) and turns it into a prompt.
 *
 * The selection comes from the Run's frozen context snapshot (`orchestrator` froze
 * `{contextSelection, goal, workId}` at dispatch time); the sources come from the real
 * Git tree, the artifact store and the Project policy through `createContextAssembly`;
 * the frozen `ContextSnapshot` is persisted and its immutable directory reported. A
 * refusal (missing required input, forbidden source, budget) is logged and `null` is
 * returned, so the caller keeps the goal+contract prompt instead of failing a Run
 * whose assessment predates the Context plane.
 */
function assembleContext(
  input: PrepareRunInput,
  options: PrepareRunOptions,
  contract: string,
): AssembledContext | null {
  const { artifacts, gitReader, snapshots, projectId, snapshotRoot } = options;
  if (
    artifacts === undefined ||
    gitReader === undefined ||
    snapshots === undefined ||
    projectId === undefined ||
    snapshotRoot === undefined
  ) {
    return null;
  }
  const log = options.log ?? (() => undefined);
  const store = options.store;
  const work = store.works.find(input.run.workId);
  if (work === undefined) return null;
  const snapshotRow = store.snapshots.list({
    where: "type = 'context' AND hash = ?",
    params: [input.run.contextSnapshotId],
  })[0];
  const parsed = contextSelectionSchema.safeParse(snapshotRow?.payload['contextSelection']);
  if (!parsed.success) {
    log(
      `prepare-run: Run ${input.run.id} has no readable contextSelection in ${input.run.contextSnapshotId}; using the goal prompt`,
    );
    return null;
  }
  const project = store.projects.find(projectId);
  if (project === undefined) return null;
  const baseRevision = work.baseRevision ?? project.head ?? '';
  const assembly = createContextAssembly({
    store,
    artifacts,
    config: options.config,
    git: gitReader,
    projectId,
    workId: work.id,
    role: input.run.role,
    policyRevision: work.policyRevision,
    stage: input.run.stage as ContextStage,
    baseRevision,
    snapshotRoot,
    ...(options.readMessageBody === undefined ? {} : { readMessageBody: options.readMessageBody }),
  });
  const contextInputs: ContextInputKey[] = ['workGoal', 'policy'];
  if (work.sourceRef.kind === 'message') contextInputs.push('userRequest');
  if (work.authorizationRef !== undefined) contextInputs.push('authorization');
  const built = buildContext({
    selection: parsed.data,
    role: input.run.role,
    stage: input.run.stage,
    project: assembly.project,
    configHash: assembly.policyHash,
    runId: input.run.id,
    workId: work.id,
    contextInputs,
    resolver: assembly.resolver,
    content: assembly.content,
    gates: assembly.gates,
    snapshotWriter: assembly.snapshotWriter,
  });
  if (!built.ok) {
    log(
      `prepare-run: Run ${input.run.id} context refused (${built.code}): ${built.errors
        .map((error) => error.message)
        .join('; ')}`,
    );
    return null;
  }
  const snapshot = built.snapshot;
  // Persist the frozen snapshot so the assembled context is durable and addressable
  // (`context.md` §1: 实际内容复制进不可变快照目录).
  snapshots.freeze('context', jsonSafe(snapshot));
  const sources = snapshot.resolvedSources.map(
    (source) =>
      `- ${source.kind}:${source.path ?? source.id}${
        source.revision === undefined ? '' : `@${source.revision}`
      } hash=${source.hash.slice(0, 12)} — ${source.reason}`,
  );
  const stageGoal = stageGoalOf(input, options.store);
  const prompt = [
    `You are the AgentDev ${input.run.role} agent.`,
    `Stage: ${input.run.stage}. Purpose: ${input.run.purpose}.`,
    `Work goal: ${work.goal}`,
    ...(stageGoal === undefined || stageGoal === work.goal
      ? []
      : [`Your stage goal: ${stageGoal}`]),
    `Frozen context ${snapshot.snapshotRef} (${String(snapshot.resolvedSources.length)} sources, ${String(
      snapshot.tokenAccounting.initial.used,
    )} tokens) at ${built.directory}:`,
    ...(sources.length === 0 ? ['- (no selected sources)'] : sources),
    contract,
  ].join('\n');
  log(
    `prepare-run: Run ${input.run.id} assembled context ${snapshot.snapshotRef} with ${String(
      snapshot.resolvedSources.length,
    )} sources`,
  );
  return { prompt, snapshotRef: snapshot.snapshotRef, directory: built.directory };
}

/** JSON-round-trips one value into the contract's JSON shape. */
function jsonSafe(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonObject;
}

/**
 * Why a per-Attempt catalog cannot be used, or `null` when it is fine.
 *
 * The Pi SDK reads `{providers: {<id>: {baseUrl, api, apiKey, models: [...]}}}`
 * (`@earendil-works/pi-coding-agent` `dist/core/model-config.js`); a missing file, empty
 * object or absent gateway entry all end as the same opaque `MODEL_UNAVAILABLE` inside the
 * Runner, so the daemon reports the concrete reason instead (WP-12 R4).
 */
export function inspectCatalog(path: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return 'the file does not exist';
  }
  if (raw.trim().length === 0) return 'the file is empty';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'the file is not valid JSON';
  }
  const providers = (parsed as { providers?: unknown }).providers;
  if (typeof providers !== 'object' || providers === null) return 'it declares no providers';
  const gateway = (providers as Record<string, unknown>)['agentdev-gateway'];
  if (typeof gateway !== 'object' || gateway === null) {
    return 'it declares no agentdev-gateway provider';
  }
  const models = (gateway as { models?: unknown }).models;
  if (!Array.isArray(models) || models.length === 0) return 'its gateway provider lists no models';
  return null;
}

export function createPrepareRun(options: PrepareRunOptions): PrepareRun {
  const log = options.log ?? (() => undefined);
  return (input: PrepareRunInput): RunnerInvocation => {
    const frozen = options.config.readFrozen(input.run.configSnapshotId);
    if (frozen === undefined) {
      throw new Error(
        `config snapshot ${input.run.configSnapshotId} is missing for Run ${input.run.id}`,
      );
    }
    const capability = options.capabilities.issue({
      attemptId: input.attempt.id,
      runId: input.run.id,
      epoch: input.epoch,
      role: input.run.role,
    });
    const attemptDir = join(options.attemptsDir, input.attempt.id);
    mkdirSync(attemptDir, { recursive: true, mode: 0o700 });
    const catalogPath = writeAttemptCatalog({
      dir: attemptDir,
      gatewayUrl: options.gatewayUrl,
      capability: capability.token,
      modelId: frozen.model.id,
      contextWindow: frozen.model.contextWindow,
      maxOutputTokens: frozen.model.maxOutputTokens,
      reasoning: frozen.profile.reasoning !== 'off',
    });
    // Fail fast when the catalog the Runner will read is not usable: a missing or empty
    // `models.json` makes a real Runner exit with `MODEL_UNAVAILABLE: model
    // agentdev-gateway/<id> is not in the catalog` before `attempt.ready` (WP-12 R4). The
    // check is on the file this call just wrote, so a bad path cannot reach the spawn.
    const catalogProblem = inspectCatalog(catalogPath);
    if (catalogProblem !== null) {
      throw new Error(`the per-Attempt catalog at ${catalogPath} is not usable: ${catalogProblem}`);
    }
    log(
      `prepare-run: ${input.run.id} attempt ${input.attempt.id} → ${frozen.provider.providerId}/${frozen.model.id}`,
    );
    return {
      cwd: options.projectRoot,
      agentDir: join(attemptDir, 'agent'),
      provider: frozen.provider.providerId,
      modelId: frozen.model.id,
      tools: [...frozen.profile.toolSubset],
      prompt:
        assembleContext(input, options, roleContractSentence(input.run.role))?.prompt ??
        promptFor(input, options.store),
      capability: capability.token,
      workId: input.run.workId,
      ...(options.controlUrl === undefined ? {} : { controlUrl: options.controlUrl }),
      catalogPath,
    };
  };
}
