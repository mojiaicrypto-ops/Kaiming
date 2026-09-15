/**
 * The daemon's side of the Runner→Core control channel (`docs/architecture/protocol.md` §6).
 *
 * §6 gives the Chief and the professional roles three internal methods — `assessment.submit`,
 * `agent.dispatch`, `stage.submit` — and the contract-violation rule underneath the table
 * ("普通文本结束没有该结果时Run等待提交提示，连续两次不合规为contract_violation"). This
 * module is the handler surface `packages/core/src/control-http.ts` calls, assembled from the
 * project's own services so the protocol and the executor share one lifecycle.
 *
 * Two properties are deliberate:
 *
 * - **Every scope check goes through the Orchestrator.** `assessmentSubmit` uses
 *   `assessWithDerivation` and `agentDispatch` uses `dispatchProfessional`; both apply the
 *   same `assertDerivableScope`/`verifyAuthorization` guards, so a derived authorization and
 *   an explicit grant are treated identically and an out-of-envelope spec is refused with a
 *   typed error before anything is written. No looser check lives here.
 * - **Ownership comes from the capability.** The caller's Run/Attempt/epoch are derived by
 *   the endpoint from the Attempt capability; this module verifies the Run is the Chief of
 *   the Work it names and never trusts a caller-supplied id.
 */
import {
  ProtocolError,
  REQUIREMENT_CONTENT_HEADINGS,
  createTaskCandidateService,
  type RunWorkspaceResolver,
  deriveProtectedPaths,
  type ArtifactService,
  type IntegrateService,
  type SettlementService,
  type SnapshotWriter,
  REQUIREMENT_EMPTY_SECTION,
  resolveWithinRoots,
  type ControlCaller,
  type ControlHandler,
  type Orchestrator,
  type ReadLedgerRegistry,
  type RequirementSaveService,
  type StageGate,
} from '@agentdev/core';
import { existsSync, readFileSync } from 'node:fs';
import {
  ROLES,
  type AssessmentPayload,
  type JsonObject,
  type SourceRef,
} from '@agentdev/contracts';
import { sha256, withTransaction, type ProjectStore } from '@agentdev/storage';
import { taskWorktreePath, type WorktreeGitPort } from '@agentdev/workspace';

import { workWriterLeaseResource } from './tool-handler.js';

/** What the daemon supplies to build the control handlers. */
export interface ControlHandlerOptions {
  readonly store: ProjectStore;
  readonly orchestrator: Orchestrator;
  readonly stageGate: StageGate;
  readonly requirementSaves?: RequirementSaveService;
  /**
   * The Attempt read ledgers (`AC-085`/`AC-032`), supplied by the execution stack.
   *
   * `context.request` appends to the same ledger `tool.execute` uses, so an extra read is
   * part of the seal a stage result commits to; without it the method refuses.
   */
  readonly readLedgers?: ReadLedgerRegistry;
  /**
   * The artifact service `decision_request` writes its question through (`T3 轮 3`).
   *
   * A Chief question is content, so it becomes a real `kind='decision'` Artifact and the
   * Decision points at it; the same service the rest of the daemon uses, so no second
   * storage path exists.
   */
  readonly artifacts?: ArtifactService;
  /**
   * The per-Task candidate commit path (`reliability.md` §4, `workflow.md` §3 L2).
   *
   * A professional Run's accepted stage result is turned into a real per-Task
   * candidate commit + frozen `VerificationManifest` + `Task.latestManifestId`
   * (`createTaskCandidateService`). All of it is optional: a stack without the git
   * port or the snapshot writer simply records the stage result, and the missing
   * manifest then fails the integration closed instead of being faked.
   */
  readonly worktrees?: WorktreeGitPort;
  readonly snapshots?: SnapshotWriter;
  readonly worktreeRoot?: string;
  readonly repoRoot?: string;
  /**
   * The root of the **persistent** per-Task workspaces (W6).
   *
   * The Run's writes live in `<taskWorkspaceRoot>/tasks/<taskId>` rather than in the
   * project root, so the candidate commit must read the changed files from there. Absent
   * means the stack predates the per-Task workspace and the project root is used, which is
   * what the candidate path did before W6.
   */
  readonly taskWorkspaceRoot?: string;
  /** The Project policy hash the `VerificationManifest` binds. */
  readonly policyHash?: string;
  /** The environment the live Attempt reported (`attempt.ready`). */
  readonly environmentRefOf?: (attemptId: string) => string | undefined;
  /**
   * The Accept/Integrate + Settlement chain of the L2 route (`reliability.md` §4/§9,
   * `workflow.md` §3/§7).
   *
   * The documented trigger point is the Settle stage: when a `purpose='settlement'` Run's
   * accepted `stage.submit` arrives, Core integrates the verified Task candidates and then
   * settles the candidate it installed. Both are optional, so a stack assembled without
   * them records the stage result alone (no candidate is ever faked).
   */
  readonly integrate?: IntegrateService;
  readonly settlement?: SettlementService;
  /**
   * The route-continuation port (`workflow.md` §3, WP-12 W4b).
   *
   * After a stage's delivery is accepted, the documented L2/L3 route continues with the
   * next professional Run (`Plan → Develop → Review → Test → Accept → Settle`) and
   * `docs/rules/agents.md` §4 makes the Chief trigger it once the result reaches Core. The
   * decision lives in Core (`protocol.ts` `continueDeliveryRoute`, which reads the route
   * from real records and reuses `queueApprovedRun`), and this handler is only the
   * documented trigger point: the accepted `stage.submit`.
   *
   * Plan provenance rides the same hook: the Planning Run's delivered Plan artifact is what
   * `approveDeliveredPlan` validates and submits to the real Plan gate, including AC-014's
   * auto-approval when the Plan is in scope with no new product choice.
   */
  /**
   * Releases the per-Task worktree lease the accepted Attempt was writing in (WP-12 W4b).
   *
   * `reliability.md` §3 keeps one writer per Task worktree with a one-hour TTL. A delivery
   * ends the Attempt's *writing* while its process is still finishing the turn, so the next
   * route stage — Review, on the same Task — resolved that worktree and got `BUSY`, fell
   * back to the project root, and honestly rejected a delivery whose change was not there.
   * Called after the candidate commit has read the files, so the released lease is the
   * caller's own and the single-writer guarantee is unchanged.
   */
  readonly releaseWorkspaceLease?: (input: {
    readonly taskId: string;
    readonly attemptId: string;
  }) => boolean;
  /**
   * The per-Task worktree resolver the tool bridge uses (WP-12 W4b).
   *
   * `context.request` used to read every requested path from `project.root` while the file
   * tools read the Run's own Task worktree, so an independent Review Run that asked for the
   * delivered file through the only channel the Product/Plan stages are given
   * (`prepare-run.ts`) was served the **unmodified** project root: it then honestly rejected
   * a delivery that had landed. Reading through the same resolver keeps one answer to
   * "where is this Run's workspace", and the path boundary is unchanged (the resolver owns
   * the root and the ledger still records the read).
   */
  readonly workspace?: RunWorkspaceResolver;
  readonly routeContinuation?: (input: {
    readonly workId: string;
    readonly runId: string;
    readonly completedRole: string;
    readonly completedStage: string;
    readonly artifactRefs: readonly { readonly id: string; readonly version: number }[];
  }) =>
    | {
        readonly runId: string | null;
        readonly stage: string | null;
        readonly reason: string | null;
      }
    | undefined;
  /** Injectable clock, ISO-8601; defaults to the store's own. */
  readonly now?: () => string;
  readonly log?: (line: string) => void;
}

/** The handlers plus the result hook the supervisor calls before settling a Run. */
export interface ControlHandlers {
  readonly handler: ControlHandler;
  /**
   * `protocol.md` §6: one corrective prompt for a Run that ended with plain text, then
   * `contract_violation`. Returns the prompt to send, or `undefined` to let it settle.
   */
  readonly onAttemptResult: (input: {
    readonly runId: string;
    readonly attemptId: string;
    readonly role: string;
    readonly submitted: boolean;
    readonly corrections: number;
    readonly text: string;
  }) => string | undefined;
}

/** The corrective prompt one non-compliant end earns. */
export const CORRECTIVE_PROMPT = [
  'This stage is not delivered: you ended the turn with plain text and no structured result.',
  'Submit through your tool (`assessment_submit` + `agent_dispatch` for the Chief,',
  '`stage_yield` for a professional role). A spoken success does not change the domain state',
  '(`docs/rules/agents.md` §4). This is your one correction; a second non-compliant end is a',
  'contract violation and ends this Run.',
].join(' ');

/**
 * Where the Run's working copy really is (W6).
 *
 * A wired per-Task workspace exists on disk after the Run's first tool call, so its
 * presence is the signal; the project root is only the pre-W6 fallback.
 */
function taskSourceRoot(
  taskWorkspaceRoot: string | undefined,
  taskId: string,
  repoRoot: string,
): string {
  if (taskWorkspaceRoot === undefined) return repoRoot;
  const path = taskWorktreePath(taskWorkspaceRoot, taskId);
  return existsSync(path) ? path : repoRoot;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the whole control handler surface for one project stack.
 */
export function createControlHandlers(options: ControlHandlerOptions): ControlHandlers {
  const { store, orchestrator, stageGate } = options;
  const now = options.now ?? ((): string => store.now());
  const log = options.log ?? ((): void => undefined);

  /**
   * `protocol.md` §6: assessment/dispatch target the Work's version.
   *
   * A mismatch is the documented `VERSION_CONFLICT` with the live version, so a stale Runner
   * re-reads instead of writing against a Work the Chief already moved on.
   */
  /**
   * Turns one accepted professional stage into a real per-Task candidate commit.
   *
   * `reliability.md` §4: the delivery route integrates verified Task commits, so the
   * stage result is not enough on its own. The candidate (worktree + commit + frozen
   * `VerificationManifest` + `Task.latestManifestId`) is produced here, where the
   * accepted result and the live Attempt's `environmentRef` are both available. A
   * missing git port, snapshot writer, policy hash or environment leaves the Task
   * without a manifest — the integration then fails closed instead of trusting a
   * fabricated one.
   */
  function commitTaskCandidate(input: {
    readonly run: {
      readonly id: string;
      readonly workId: string;
      readonly taskId?: string;
      readonly role: string;
      readonly configSnapshotId: string;
      readonly contextSnapshotId: string;
    };
    readonly attemptId: string;
    readonly result: {
      readonly changedPaths: readonly string[];
      readonly readLedgerSeq: number;
      readonly readLedgerHash: string;
    };
  }): void {
    const { worktrees, snapshots, worktreeRoot, repoRoot, policyHash, taskWorkspaceRoot } = options;
    if (
      worktrees === undefined ||
      snapshots === undefined ||
      worktreeRoot === undefined ||
      repoRoot === undefined ||
      policyHash === undefined ||
      input.run.taskId === undefined
    ) {
      return;
    }
    const work = store.works.find(input.run.workId);
    const task = store.tasks.find(input.run.taskId);
    if (work === undefined || task === undefined) return;
    const service = createTaskCandidateService({
      store,
      worktrees,
      snapshots,
      repoRoot,
      worktreeRoot,
      log,
    });
    const committed = service.commit({
      workId: work.id,
      taskId: task.id,
      runId: input.run.id,
      role: input.run.role as never,
      level: work.level,
      route: work.level,
      planRef: task.planRef,
      dependencyRevision: task.dependencyRevision ?? work.baseRevision ?? '',
      dependencyManifestRefs: task.dependencyManifestRefs,
      acceptanceIds: task.acceptanceIds,
      policyHash,
      configHash: input.run.configSnapshotId,
      contextSnapshotId: input.run.contextSnapshotId,
      readLedgerSeq: input.result.readLedgerSeq,
      readLedgerHash: input.result.readLedgerHash,
      environmentRef: options.environmentRefOf?.(input.attemptId) ?? '',
      changedPaths: input.result.changedPaths,
      // W6: the Run's files are in its own Task worktree. Reading them from the project
      // root would commit whatever the *project* happens to hold — the stale base — so the
      // candidate would silently drop the Task's work. The project root stays the fallback
      // only for a stack that never wired the per-Task workspace.
      sourceRoot: taskSourceRoot(taskWorkspaceRoot, task.id, repoRoot),
      message: `feat(task): ${task.id} 的候选提交`,
    });
    if (!committed.ok) {
      log(
        `control: Task ${task.id} candidate not committed (${committed.code}): ${committed.message}`,
      );
      return;
    }
    log(
      `control: Task ${task.id} candidate ${committed.revision} manifest ${committed.manifestId}`,
    );
  }

  /**
   * The Accept/Integrate → Settlement chain of the L2 route (`workflow.md` §3/§7).
   *
   * `protocol.md` §6 puts the Settle stage's result on this channel, so an accepted
   * `stage.submit` from a `purpose='settlement'` Run is the documented point at which Core
   * must (1) integrate the verified Task candidates onto the delivery branch through the
   * Workspace/CAS path (`AC-012`) and (2) settle the candidate it installed
   * (`reliability.md` §4 steps 6–9). A failure of either half is returned to the Runner as
   * typed data instead of being swallowed — the stage result itself stays accepted, which is
   * what makes the failure visible and retriable rather than silent.
   */
  function integrateAndSettle(input: {
    readonly workId: string;
    readonly operationId: string;
  }): JsonObject | undefined {
    const { integrate, settlement } = options;
    if (integrate === undefined || settlement === undefined) return undefined;
    // `workflow.md` §5.1 + `reliability.md` §4 steps 6–9: integration and settlement install
    // one delivery for an **open** Work, which is the same barrier the Plan gate applies to
    // writes. A second Settle stage result arriving after the Work was completed — a Chief
    // that re-dispatched the stage while Core had already queued it — must therefore be
    // recorded as a stage result and do nothing else: integrating again would publish a
    // second `settlement.completed` at a new revision for a Work that is already delivered
    // (observed on the real L2 route, WP-12 W4c).
    const currentWork = store.works.find(input.workId);
    if (currentWork !== undefined && currentWork.status !== 'running') {
      log(
        `control: Work ${input.workId} is ${currentWork.status}; the Settle stage result is recorded without a second integration`,
      );
      return { status: 'skipped', reason: `Work ${input.workId} is ${currentWork.status}` };
    }
    const integrationOperationId = `integrate:${input.operationId}`;
    const integrated = integrate.integrate({
      workId: input.workId,
      operationId: integrationOperationId,
    });
    if (!integrated.ok) {
      log(
        `control: Work ${input.workId} integration refused (${integrated.code}): ${integrated.message}`,
      );
      return {
        status: 'refused',
        step: 'integrate',
        code: integrated.code,
        message: integrated.message,
        branchUntouched: true,
      };
    }
    const settled = settlement.settleFromIntegration({
      operationId: integrationOperationId,
    });
    if (!settled.ok) {
      log(`control: Work ${input.workId} settlement refused (${settled.code}): ${settled.message}`);
      return {
        status: 'refused',
        step: 'settle',
        code: settled.code,
        message: settled.message,
        revision: integrated.revision,
      };
    }
    log(
      `control: Work ${input.workId} settled at ${settled.revision} (requirement ${
        settled.requirementCompleted ? 'completed' : 'not completed'
      }${
        settled.requirementCompletionError === undefined
          ? ''
          : `: ${JSON.stringify(settled.requirementCompletionError)}`
      })`,
    );
    return {
      status: 'settled',
      revision: settled.revision,
      manifestId: settled.manifestId,
      requirementCompleted: settled.requirementCompleted,
      ...(settled.requirementRecordVersion === undefined
        ? {}
        : { requirementRecordVersion: settled.requirementRecordVersion }),
      ...(settled.requirementCompletionError === undefined
        ? {}
        : { requirementCompletionError: settled.requirementCompletionError }),
    };
  }

  /**
   * The route continuation after one accepted stage (`workflow.md` §3, WP-12 W4b).
   *
   * The decision itself is Core's (`protocol.ts` `continueDeliveryRoute` reads the route
   * from real records and reuses `queueApprovedRun`); this helper only forwards the facts of
   * the accepted delivery — the Run, the stage and the artifacts it pinned — and reports the
   * outcome. A port that throws or names its own reason is logged rather than failing the
   * `stage.submit`: the delivery really was accepted, and a continuation problem is a
   * delivery problem for the operator, not a reason to make the model resubmit.
   */
  function continueRoute(
    run: {
      readonly id: string;
      readonly workId: string;
      readonly role: string;
      readonly stage: string;
    },
    row: {
      readonly id: string;
      readonly status: string;
      readonly artifactRefs: readonly unknown[];
    },
    operationId: string | undefined,
  ): JsonObject | undefined {
    const port = options.routeContinuation;
    if (port === undefined) return undefined;
    const artifactRefs = row.artifactRefs.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
      const ref = entry as Record<string, unknown>;
      const id = ref['id'];
      const version = ref['version'];
      if (typeof id !== 'string' || id === '') return [];
      return [{ id, version: typeof version === 'number' ? version : Number(version ?? 1) }];
    });
    try {
      const result = port({
        workId: run.workId,
        runId: run.id,
        completedRole: run.role,
        completedStage: run.stage,
        artifactRefs,
      });
      if (result === undefined || result === null) return undefined;
      return {
        stage: result.stage,
        runId: result.runId,
        reason: result.reason,
        operationId: operationId ?? null,
      };
    } catch (error) {
      log(
        `control: route continuation after ${run.stage} of ${run.workId} refused: ${errorText(error)}`,
      );
      return undefined;
    }
  }

  function requireWorkVersion(workId: string, expectedVersion: number | undefined): void {
    if (expectedVersion === undefined) return;
    const work = store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
    }
    if (work.version !== expectedVersion) {
      throw new ProtocolError(
        'VERSION_CONFLICT',
        `Work ${workId} is at version ${String(work.version)}, not ${String(expectedVersion)}`,
        { details: { workId, currentVersion: work.version, expectedVersion } },
      );
    }
  }

  /** The Chief Run a control call is bound to, checked against the Work it names. */
  function requireChiefRun(caller: ControlCaller, workId: string): void {
    if (caller.role !== 'chief') {
      throw new ProtocolError(
        'NOT_AUTHORIZED',
        `${caller.role} may not call a Chief-only control method`,
        { details: { runId: caller.runId, role: caller.role } },
      );
    }
    const run = store.runs.find(caller.runId);
    if (run === undefined || run.role !== 'chief' || run.workId !== workId) {
      throw new ProtocolError(
        'NOT_AUTHORIZED',
        `Run ${caller.runId} is not the Chief Run of Work ${workId}`,
        { details: { runId: caller.runId, workId } },
      );
    }
  }

  /** The provenance a derived authorization is recorded under (`workflow.md` §1). */
  function sourceOf(workId: string): SourceRef | undefined {
    const work = store.works.find(workId);
    const source = work?.sourceRef;
    return source === undefined
      ? undefined
      : { kind: source.kind, id: source.id, version: source.version };
  }

  /**
   * Ensures the Work has the Requirement its level requires (`requirements.md` §1).
   *
   * `PRODUCT.md` §3: L2/L3 delivery is associated with a Requirement, and the board renders
   * requirements only — so this record is what makes the work visible. The body is built by
   * Core from the assessment facts (never from model prose), and a Work that already has an
   * active Requirement keeps it.
   */
  function ensureRequirement(input: {
    readonly workId: string;
    readonly assessment: AssessmentPayload;
    readonly sourceRef: SourceRef | undefined;
  }): string | null {
    const existing = store.requirements
      .list({ where: 'work_id = ?', params: [input.workId] })
      .find((row) => row.lifecycle === 'active' || row.lifecycle === 'queued');
    if (existing !== undefined) return existing.id;
    const saves = options.requirementSaves;
    if (saves === undefined) {
      log(`control: Work ${input.workId} has no Requirement service; the record was not saved`);
      return null;
    }
    const source = input.sourceRef;
    if (source === undefined) {
      log(`control: Work ${input.workId} has no source to record a Requirement under`);
      return null;
    }
    const scope = input.assessment.scope;
    const paths = [...new Set([...scope.readPaths, ...scope.writePaths])];
    const content = [
      `## ${REQUIREMENT_CONTENT_HEADINGS[0]}`,
      '',
      input.assessment.goal,
      '',
      `## ${REQUIREMENT_CONTENT_HEADINGS[1]}`,
      '',
      paths.length === 0
        ? REQUIREMENT_EMPTY_SECTION
        : paths.map((path) => `- \`${path}\``).join('\n'),
      '',
      `## ${REQUIREMENT_CONTENT_HEADINGS[2]}`,
      '',
      REQUIREMENT_EMPTY_SECTION,
      '',
      `## ${REQUIREMENT_CONTENT_HEADINGS[3]}`,
      '',
      input.assessment.reason,
      '',
      `## ${REQUIREMENT_CONTENT_HEADINGS[4]}`,
      '',
      input.assessment.uncertainties.length === 0
        ? REQUIREMENT_EMPTY_SECTION
        : input.assessment.uncertainties.map((item) => `- ${item}`).join('\n'),
      '',
      `## ${REQUIREMENT_CONTENT_HEADINGS[5]}`,
      '',
      REQUIREMENT_EMPTY_SECTION,
      '',
    ].join('\n');
    const requirementId = store.newId();
    const at = now();
    // `WP-12` fix round 3: the Git-backed save and the `phase='plan'` projection write share
    // one transaction, so a failure cannot leave an active Requirement with a stale phase
    // (the save service's own transaction nests as a savepoint).
    const outcome = withTransaction(store.db, () => {
      const saved = saves.save({
        operationId: `requirement:${input.workId}`,
        metadata: {
          schemaVersion: 1,
          id: requirementId,
          version: 1,
          contentFile: 'content.md',
          createdAt: at,
          updatedAt: at,
          title: input.assessment.goal.slice(0, 200),
          goal: input.assessment.goal,
          scope,
          // The requirement is being planned; the Plan gate moves it on (`workflow.md` §5.1).
          lifecycle: 'active',
          featureIds: [],
          acceptance: [],
          openQuestions: [...input.assessment.uncertainties],
          confirmedDecisions: [],
          relatedRequirementIds: [],
        } as never,
        contentMarkdown: content,
        expected: { expectedAbsent: true },
        sourceRef: { kind: source.kind, id: source.id, version: source.version },
        workId: input.workId,
        kind: 'create',
      });
      if (!saved.ok) return saved;
      // `requirements.md` §5.1: an active Requirement is in its planning phase — written in
      // the same transaction as the Git-backed save.
      store.requirements.update(saved.row.id, { phase: 'plan' }, saved.row.version);
      // `data.md` §2 `work.requirementId` and `PRODUCT.md` §3 ("L2/L3 交付均关联
      // Requirement"): the association is a *Work* field, and `workflow.md` §7 completes the
      // Requirement only "存在 requirementId 时". Binding it here — in the same transaction
      // as the save — is what lets the settlement's completion path resolve the Requirement:
      // without it the L2 route reached `Work completed` and left the Requirement at
      // `active/plan` (`integration.requirementId ?? work.requirementId` was undefined), so
      // the pool record was never completed (WP-12 W4c).
      const current = store.works.find(input.workId);
      if (current !== undefined && current.requirementId === undefined) {
        store.works.update(current.id, { requirementId: saved.requirementId }, current.version);
      }
      return saved;
    });
    if (!outcome.ok) {
      log(`control: Requirement save for Work ${input.workId} failed: ${outcome.code}`);
      return null;
    }
    return outcome.requirementId;
  }

  /**
   * `protocol.md` §6: "所有调用带 operationId 以便重派去重".
   *
   * The key is `(attemptId, method, operationId)` and the answer is the command ledger, so a
   * replay of the same payload returns the first result (no second Run, no second
   * `stage_result`, no second `stage.completed`) and the same key with a different payload is
   * an `IDEMPOTENCY_CONFLICT`. A call without `operationId` runs as before; a refused call
   * drops its ledger row so a corrected retry with the same key is free to run.
   */
  function dedupe<T extends JsonObject>(input: {
    readonly caller: ControlCaller;
    readonly method: string;
    readonly operationId: string | undefined;
    readonly payload: JsonObject;
    readonly action: () => T;
  }): JsonObject {
    if (input.operationId === undefined) return input.action();
    const subject = `attempt:${input.caller.attemptId}`;
    const operation = `control.${input.method}`;
    const begun = store.commands.begin({
      subject,
      operation,
      key: input.operationId,
      payloadHash: sha256(JSON.stringify(input.payload)),
    });
    if (begun.kind === 'conflict') {
      throw new ProtocolError('IDEMPOTENCY_CONFLICT', begun.reason, {
        details: { method: input.method, operationId: input.operationId },
      });
    }
    if (begun.kind === 'replay') return begun.response as JsonObject;
    let reply: JsonObject;
    try {
      reply = input.action();
    } catch (error) {
      // The key must not pin a failure: the same key may retry once the payload is fixed.
      store.db.prepare('DELETE FROM command WHERE id = ?').run(begun.commandId);
      throw error;
    }
    store.commands.complete(begun.commandId, reply);
    return reply;
  }

  /** The Work one control call names, or the documented refusal. */
  function requireWork(workId: string) {
    const work = store.works.find(workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
    }
    return work;
  }

  /** The Run of the calling capability, checked to belong to the Work it names. */
  function requireOwnRun(caller: ControlCaller, workId: string) {
    const run = store.runs.find(caller.runId);
    if (run === undefined) {
      throw new ProtocolError('NOT_FOUND', `Run ${caller.runId} does not exist`);
    }
    if (run.workId !== workId) {
      throw new ProtocolError(
        'NOT_AUTHORIZED',
        `Run ${run.id} belongs to Work ${run.workId}, not ${workId}`,
      );
    }
    return run;
  }

  /**
   * `protocol.md` §6 `context.request`: append reads inside the Run's own ACL scope.
   *
   * `AC-032`/`AC-085`: content is returned only for a ref the Run may read (the ledger's ACL
   * is the authority), each admitted read is appended to the same ledger `tool.execute`
   * writes, and a ref outside the scope is recorded as a pending expansion **and** escalated
   * with a `chief_action_required` event — a professional Run cannot widen its own scope
   * (`rules/agents.md` §2/§3).
   */
  function contextRequest(
    caller: ControlCaller,
    workId: string,
    requestedRefs: readonly JsonObject[],
    reason: string,
  ): JsonObject {
    const work = requireWork(workId);
    const run = requireOwnRun(caller, work.id);
    const ledgers = options.readLedgers;
    if (ledgers === undefined) {
      throw new ProtocolError(
        'PROVIDER_UNAVAILABLE',
        'context.request needs the read ledger, which this daemon has not attached',
      );
    }
    const project = store.projects.find(work.projectId);
    if (project === undefined) {
      throw new ProtocolError('NOT_FOUND', `Project ${work.projectId} is not open`);
    }
    const protectedPaths = deriveProtectedPaths(store, undefined, []);
    const items: JsonObject[] = [];
    const outOfScope: JsonObject[] = [];
    for (const ref of requestedRefs) {
      const path =
        typeof ref['path'] === 'string'
          ? ref['path']
          : typeof ref['id'] === 'string'
            ? ref['id']
            : '';
      if (path === '') {
        throw new ProtocolError('VALIDATION_ERROR', 'each requestedRef needs a path');
      }
      const refReason = typeof ref['reason'] === 'string' ? ref['reason'] : reason;
      // The Run's own workspace (its per-Task worktree when the stack has one), never the
      // project root blindly: see the `workspace` option.
      const workspaceRoot =
        options.workspace === undefined
          ? project.root
          : options.workspace.resolve({
              workId: work.id,
              runId: run.id,
              attemptId: caller.attemptId,
              epoch: caller.epoch,
            }).root;
      const decision = resolveWithinRoots({
        path,
        access: 'read',
        roots: [workspaceRoot],
        protectedPaths,
      });
      if (!decision.ok) {
        ledgers.recordOutOfScope({
          attemptId: caller.attemptId,
          runId: run.id,
          role: caller.role,
          stage: run.stage,
          ...(work.baseRevision === undefined ? {} : { revision: work.baseRevision }),
          path,
          reason: `${decision.code}: ${decision.reason}`,
        });
        outOfScope.push({ path, code: decision.code, reason: decision.reason });
        continue;
      }
      let content: string;
      try {
        content = readFileSync(decision.realPath, 'utf8');
      } catch (error) {
        outOfScope.push({
          path,
          code: 'NOT_FOUND',
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const recorded = ledgers.record({
        attemptId: caller.attemptId,
        runId: run.id,
        role: caller.role,
        stage: run.stage,
        ...(work.baseRevision === undefined ? {} : { revision: work.baseRevision }),
        path,
        reason: `context.request: ${refReason}`,
        content,
      });
      if (!recorded.ok) {
        ledgers.recordOutOfScope({
          attemptId: caller.attemptId,
          runId: run.id,
          role: caller.role,
          stage: run.stage,
          path,
          reason: `${recorded.code}: ${recorded.message}`,
        });
        outOfScope.push({ path, code: recorded.code, reason: recorded.message });
        continue;
      }
      items.push({
        path,
        revision: recorded.entry.revision,
        hash: recorded.entry.hash,
        bytes: recorded.entry.bytes,
        content,
      });
    }
    if (outOfScope.length > 0) {
      // The Chief is the only role that may widen a scope, so the refusal becomes an action
      // for it rather than a silent empty answer (`rules/agents.md` §3).
      store.events.append({
        name: 'chief_action_required',
        entityId: work.id,
        entityVersion: work.version,
        data: {
          workId: work.id,
          runId: run.id,
          role: caller.role,
          kind: 'context',
          requestedPaths: outOfScope.map((entry) =>
            typeof entry['path'] === 'string' ? entry['path'] : '',
          ),
          reason,
        },
      });
    }
    return {
      status: 'applied',
      items,
      outOfScope,
      escalated: outOfScope.length > 0,
      ledger: { ...ledgers.binding(caller.attemptId) },
    };
  }

  /**
   * `protocol.md` §6 `agent.request_dispatch`: a professional Run asks the Chief for another
   * role. It never creates a Run — the Chief decides (`rules/agents.md` §3).
   */
  function agentRequestDispatch(
    caller: ControlCaller,
    workId: string,
    reason: string,
    requestedRole: string,
    goal: string,
    sourceRefs: readonly JsonObject[],
  ): JsonObject {
    const work = requireWork(workId);
    const run = requireOwnRun(caller, work.id);
    if (!(ROLES as readonly string[]).includes(requestedRole)) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `requestedRole ${requestedRole} is not a documented role`,
      );
    }
    store.events.append({
      name: 'chief_action_required',
      entityId: work.id,
      entityVersion: work.version,
      data: {
        workId: work.id,
        runId: run.id,
        role: caller.role,
        kind: 'request_dispatch',
        requestedRole,
        goal,
        reason,
        sourceRefs: [...sourceRefs],
      },
    });
    log(`control-handler: ${run.id} requested a ${requestedRole} dispatch`);
    return {
      status: 'accepted',
      requiredRole: requestedRole,
      event: 'chief_action_required',
    };
  }

  /**
   * `execution.md` §7 `decision_request` (Chief): ask the user a product question.
   *
   * Option A of the T3 round-3 ruling: the question body is a real `kind='decision'`
   * Artifact (`protocol.md` §7 keeps event `data` to a summary; the full content is fetched
   * by `get`), and the `decision` row's `targetRef` points at it with its version and content
   * hash. The answer arrives through the existing `decision.resolve`, so `accept` and the
   * caller's own choices close the row without a second resolution path.
   *
   * `choices` defaults to `['accept','decline']`. `accept` resolves the question row through
   * the ordinary `decision.resolve` path, while `decline` is the repository's documented
   * *product behaviour* branch (`protocol.ts` `isBehaviourChoice`): it records the decline as
   * a follow-up product decision and supersedes the question instead of flipping its row. Both
   * answers are therefore applied and auditable; the record explains which is which, and a
   * Chief that wants the full `now`/`later`/`decline` vocabulary can pass it explicitly.
   */
  function decisionRequest(
    caller: ControlCaller,
    workId: string,
    question: string,
    choices: readonly string[],
  ): JsonObject {
    requireChiefRun(caller, workId);
    const work = requireWork(workId);
    const artifacts = options.artifacts;
    if (artifacts === undefined) {
      throw new ProtocolError(
        'PROVIDER_UNAVAILABLE',
        'decision_request needs the artifact service, which this daemon has not attached',
      );
    }
    const run = store.runs.find(caller.runId);
    if (run === undefined) {
      throw new ProtocolError('NOT_FOUND', `Run ${caller.runId} does not exist`);
    }
    const answerChoices = choices.length === 0 ? ['accept', 'decline'] : [...choices];
    if (answerChoices.length > 1000 || answerChoices.some((choice) => choice.trim() === '')) {
      throw new ProtocolError('VALIDATION_ERROR', 'choices must be 1–1000 non-empty strings', {
        details: { choices: answerChoices.length },
      });
    }
    const artifact = artifacts.createAgent({
      run: { id: run.id, workId: work.id, role: 'chief' },
      kind: 'decision',
      mime: 'text/markdown',
      bytes: Buffer.from(question, 'utf8'),
    });
    const decision = store.decisions.insert({
      projectId: work.projectId,
      workId: work.id,
      kind: 'product',
      targetRef: { id: artifact.id, version: artifact.version, hash: artifact.contentHash },
      choices: answerChoices,
      state: 'pending',
      actor: 'user',
      effectRefs: [artifact.id],
    });
    store.events.append({
      name: 'decision.created',
      entityId: decision.id,
      entityVersion: decision.version,
      data: {
        workId: work.id,
        runId: run.id,
        kind: 'product',
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        choices: answerChoices,
      },
    });
    log(`control-handler: ${run.id} asked a product decision (${decision.id})`);
    return {
      status: 'pending',
      decisionId: decision.id,
      version: decision.version,
      workId: work.id,
      artifactId: artifact.id,
      artifactVersion: artifact.version,
      choices: answerChoices,
    };
  }

  const handler: ControlHandler = {
    contextRequest: ({ caller, workId, requestedRefs, reason }) =>
      contextRequest(caller, workId, requestedRefs, reason),
    agentRequestDispatch: ({ caller, workId, reason, requestedRole, goal, sourceRefs }) =>
      agentRequestDispatch(caller, workId, reason, requestedRole, goal, sourceRefs),
    decisionRequest: ({ caller, workId, question, choices }) =>
      decisionRequest(caller, workId, question, choices),
    assessmentSubmit: ({ caller, workId, assessment, operationId, expectedVersion }) => {
      requireChiefRun(caller, workId);
      requireWorkVersion(workId, expectedVersion);
      const payload = assessment as unknown as AssessmentPayload;
      return dedupe({
        caller,
        method: 'assessment.submit',
        operationId,
        payload: { workId, assessment },
        action: () => {
          const source = sourceOf(workId);
          const { assessment: saved, authorizationRef } = orchestrator.assessWithDerivation({
            workId,
            payload,
            ...(source === undefined ? {} : { sourceRef: source }),
          });
          // A delivery/document route enters the requirement pool; assist/artifact does not
          // (`PRODUCT.md` §3, `workflow.md` §3).
          // `PRODUCT.md` §3/§4.4 + `workflow.md` §3: an L1 change is a Chief-side one-liner that
          // never enters the requirement pool or the board (AC-007/AC-068); only L2/L3 delivery
          // and document routes do. An L1 assessment inside an existing active Requirement still
          // reuses it (`ensureRequirement` checks first).
          const needsRequirement =
            (payload.intent === 'delivery' || payload.intent === 'document') &&
            (payload.level === 'L2' || payload.level === 'L3');
          const reusesRequirement =
            payload.level === 'L1' &&
            store.requirements
              .list({ where: 'work_id = ?', params: [workId] })
              .some((row) => row.lifecycle === 'active' || row.lifecycle === 'queued');
          const requirementId =
            needsRequirement || reusesRequirement
              ? ensureRequirement({ workId, assessment: payload, sourceRef: source })
              : null;
          const work = store.works.find(workId);
          return {
            saved: true,
            workId,
            assessmentId: saved.id,
            level: saved.level,
            intent: saved.intent,
            authorizationId: authorizationRef ?? null,
            requirementId,
            workLevel: work?.level ?? null,
            // `protocol.md` §6: the method returns the Gate that now applies to the Work.
            gate: requirementId === null ? 'none' : 'product',
          };
        },
      });
    },

    agentDispatch: ({ caller, spec, operationId, expectedVersion }) => {
      const run = store.runs.find(caller.runId);
      if (run === undefined || run.role !== 'chief') {
        throw new ProtocolError('NOT_AUTHORIZED', `Run ${caller.runId} is not a Chief Run`, {
          details: { runId: caller.runId, role: run?.role ?? null },
        });
      }
      requireWorkVersion(run.workId, expectedVersion);
      return dedupe({
        caller,
        method: 'agent.dispatch',
        operationId,
        payload: { spec },
        action: () => {
          const { run: queued } = orchestrator.dispatchProfessional({
            parentRunId: caller.runId,
            spec,
          });
          return { runId: queued.id, status: 'queued' };
        },
      });
    },

    stageSubmit: ({ caller, result, operationId, expectedVersion }) => {
      // The professional path: the Attempt's own Run is the target, and `StageGate.submit`
      // derives `runId`/`attemptId`/`taskId` from the capability (`protocol.md` §6).
      const run = store.runs.find(caller.runId);
      if (run === undefined) {
        throw new ProtocolError('NOT_FOUND', `Run ${caller.runId} does not exist`);
      }
      if (run.role === 'chief') {
        throw new ProtocolError(
          'VALIDATION_ERROR',
          'a Chief Run submits an assessment, not a stage result',
          { details: { runId: run.id } },
        );
      }
      // One accepted delivery per Attempt (`rules/agents.md` §4: the stage is delivered or
      // not at all). A duplicate with a *different* key is refused rather than recorded
      // twice; the same key is answered by the ledger above.
      const delivered = store.stageResults
        .list({ where: 'attempt_id = ?', params: [caller.attemptId] })
        .at(0);
      if (delivered !== undefined) {
        throw new ProtocolError(
          'INVALID_STATE',
          `Attempt ${caller.attemptId} already delivered stage result ${delivered.id}`,
          { details: { runId: run.id, stageResultId: delivered.id } },
        );
      }
      return dedupe({
        caller,
        method: 'stage.submit',
        operationId,
        payload: { result },
        action: () => {
          const outcome = stageGate.submit({
            runId: run.id,
            attemptId: caller.attemptId,
            epoch: caller.epoch,
            ...(expectedVersion === undefined ? {} : { expectedVersion }),
            payload: result,
          });
          if (outcome.accepted) {
            // The delivery is accepted, so this Attempt is done writing: release the Work's
            // single-writer lease now. Under the L2 route the next stage's Run (Core queues
            // the develop Run from the approved Plan) starts immediately, and a lease held
            // for the rest of its TTL would make that Run spend its first turns on `BUSY`
            // refusals — a real delivery would then depend on the model out-retrying the
            // lease, which it does not reliably do under load (WP-12 W4). Releasing a lease
            // this Attempt holds takes no authority away from anyone else.
            try {
              store.leases.release(
                workWriterLeaseResource(run.projectId, run.workId),
                caller.attemptId,
                caller.epoch,
              );
            } catch (error) {
              log(
                `control: could not release the writer lease of Work ${run.workId}: ${errorText(error)}`,
              );
            }
            // The stage is recorded; the **implementer's** Task candidate commit follows so
            // the integration has a verified revision to cherry-pick (`reliability.md` §4).
            // Only a role that may write source produces a candidate: Review/Test read the
            // frozen copy and Settlement edits authorized documentation, so a candidate
            // committed from their (unchanged) worktree would overwrite the implementer's
            // candidate with the base tree — the integration then had a Task whose latest
            // manifest came from a read-only stage (WP-12 W4b).
            const implementer = run.role === 'backend' || run.role === 'frontend';
            if (implementer) {
              commitTaskCandidate({
                run: {
                  id: run.id,
                  workId: run.workId,
                  ...(run.taskId === undefined ? {} : { taskId: run.taskId }),
                  role: run.role,
                  configSnapshotId: run.configSnapshotId,
                  contextSnapshotId: run.contextSnapshotId,
                },
                attemptId: caller.attemptId,
                result: {
                  // `stageGate.submit` already validated the payload against
                  // `stageResultSchema`; these guards only satisfy the JSON type.
                  changedPaths: Array.isArray(result['changedPaths'])
                    ? result['changedPaths'].filter(
                        (path): path is string => typeof path === 'string',
                      )
                    : [],
                  readLedgerSeq:
                    typeof result['readLedgerSeq'] === 'number' ? result['readLedgerSeq'] : 0,
                  readLedgerHash:
                    typeof result['readLedgerHash'] === 'string' ? result['readLedgerHash'] : '',
                },
              });
            }
            // The candidate commit above has already read the Task's files, so the
            // worktree lease can go back now: the next stage of the route runs on the same
            // Task and must be able to resolve that tree instead of `BUSY`.
            if (run.taskId !== undefined && options.releaseWorkspaceLease !== undefined) {
              try {
                options.releaseWorkspaceLease({
                  taskId: run.taskId,
                  attemptId: caller.attemptId,
                });
              } catch (error) {
                log(`control: could not release the Task worktree lease: ${errorText(error)}`);
              }
            }
            // The L2/L3 Settle stage: this accepted result is the route's Accept/Integrate
            // point, so the verified Task candidates are integrated and then settled
            // (`workflow.md` §3/§7). Any refusal is surfaced in the response.
            const delivery =
              run.purpose === 'settlement'
                ? integrateAndSettle({
                    workId: run.workId,
                    operationId: operationId ?? `${run.id}:${caller.attemptId}`,
                  })
                : undefined;
            // `workflow.md` §3 / `docs/rules/agents.md` §4: the next stage of the route is
            // triggered once a stage result reaches Core. Plan provenance rides the same
            // hook (`protocol.ts` `approveDeliveredPlan` reads the Planning Run's delivered
            // Plan artifact, validates it and submits it to the real Plan gate, including
            // AC-014's auto-approval), and after Accept/Settle the route is complete.
            const continuation =
              outcome.row.status === 'success'
                ? continueRoute(run, outcome.row, operationId)
                : undefined;
            return {
              accepted: true,
              stageResultId: outcome.row.id,
              status: outcome.row.status,
              outcome: outcome.row.status,
              ...(delivery === undefined ? {} : { delivery }),
              ...(continuation === undefined ? {} : { continuation }),
            };
          }
          // A Schema rejection is the documented `stage.submit` result, not a transport
          // failure: the Runner's client turns `accepted:false` into a tool error so the model
          // can correct, and the endpoint does not count it as a delivery (`protocol.md` §6).
          if (outcome.code === 'CONTRACT_VIOLATION') {
            return {
              accepted: false,
              code: outcome.code,
              message: outcome.message,
              runStatus: outcome.runStatus,
              rejections: outcome.rejections,
            };
          }
          return {
            accepted: false,
            code: outcome.code,
            message: outcome.message,
            correctionsRemaining: outcome.correctionsRemaining,
          };
        },
      });
    },
  };

  return {
    handler,
    onAttemptResult: (input) => {
      if (input.submitted) return undefined;
      if (input.corrections === 0) return CORRECTIVE_PROMPT;
      // The second non-compliant end: the documented contract violation, recorded through
      // the shared lifecycle so the budget reservation is released exactly once.
      try {
        orchestrator.lifecycle.contractViolation(input.runId, {
          attemptId: input.attemptId,
          reason: 'the Attempt ended twice without a structured submission',
          rejections: input.corrections + 1,
        });
      } catch (error) {
        log(
          `control: could not record the contract violation of ${input.runId}: ${errorText(error)}`,
        );
      }
      return undefined;
    },
  };
}
