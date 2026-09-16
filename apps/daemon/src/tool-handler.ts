/**
 * The daemon's `tool.execute` handler: one tool call, planned and run through the Broker.
 *
 * `docs/architecture/execution.md` §2 puts execution here — "Core直接处理文件和领域工具；
 * Shell请求由Supervisor另起工具容器" — and `protocol.md` §5 explains where the modules
 * live: the web layer only serves the SPA, the daemon owns the project. This module is the
 * daemon-side half of the tool bridge:
 *
 * - it resolves the Run and its Work from the **capability-derived** caller
 *   (`control-http.ts` `authenticate`), never from the request body, and refuses a caller
 *   whose role disagrees with the Run's own row;
 * - it asserts the Work's single-writer lease before every call, so two Attempts of the
 *   same Work cannot write the same tree at once (`reliability.md` §3: "写入另受
 *   Worktree单writer锁"; `data.md` §2 `lease`);
 * - it resolves the Run's workspace root (`RunWorkspaceResolver`) and hands it to the
 *   Broker as the only root;
 * - it plans the call with the shared contract schemas (`packages/core/src/tools.ts`),
 *   which is where the role gate, the `~`/absolute-path entry check and the read-only
 *   `git` allowlist live;
 * - it attaches the executor Core owns: `artifact_write` goes to `ArtifactService`
 *   (`execution.md` §2; the Broker's own built-in for that name writes a file, so the
 *   domain tool must supply its body), `read`/`search`/`edit` come from
 *   `core/tools.ts`, and `write`/`bash`/`git` use the Broker's built-in executors;
 * - it invokes the Broker, which re-checks the Grant, both file boundaries, the role gate
 *   and the network policy, and records the `tool_operation` plus `tool.invoked`/
 *   `tool.refused` audit events.
 *
 * ## Per-Task worktree (W6)
 *
 * The workspace resolver is injected. Production passes
 * `core`'s `createTaskWorktreeWorkspaceResolver`, so a professional Run is rooted at its
 * Task's own external Git worktree (`reliability.md` §4) under the worktree manager's
 * `(attempt, epoch)` lease, and a delete inside that root cannot name another Task's file.
 * {@link createProjectRootWorkspaceResolver} remains as the documented fallback for a
 * caller that has no worktree manager (tests, a stack assembled without Git); it reports
 * `taskWorktree: false` rather than pretending.
 */
import {
  LIMITS,
  roleHasBrokerTool,
  type ArtifactKind,
  type ConfigPolicy,
  type JsonObject,
  type Purpose,
  type Role,
} from '@agentdev/contracts';
import {
  ProtocolError,
  SENSITIVE_FILE_TODO_KIND,
  isReadOnlyRole as callIsReadOnly,
  matchSensitiveFile,
  planToolCall,
  requiresPerOccurrenceApproval,
  hashToolInput,
  type ReadLedgerRegistry,
  type SecretStore,
  type ToolGrantService,
  runEditTool,
  runReadTool,
  runSearchTool,
  type ArtifactService,
  type Broker,
  type PlanGateService,
  type RunWorkspaceResolver,
  type ToolSuccess,
} from '@agentdev/core';
import type { ProjectStore } from '@agentdev/storage';
import type {
  PermissionRequestHandler,
  ToolExecuteCaller,
  ToolExecuteHandler,
} from '@agentdev/core';

/**
 * The documented fallback: the project root, with the gap reported rather than hidden.
 *
 * The resolver refuses a Run whose project is not open, because a tool call must never
 * fall back to a path nobody authorized. Production wires the per-Task worktree resolver
 * instead (`main.ts`), so this one is only what a stack assembled without a worktree
 * manager gets — and it says `taskWorktree: false` so the log can report it.
 */
export function createProjectRootWorkspaceResolver(
  store: Pick<ProjectStore, 'runs' | 'works' | 'projects'>,
): RunWorkspaceResolver {
  return {
    resolve: ({ workId, runId }) => {
      const work = store.works.find(workId);
      if (work === undefined) {
        throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`);
      }
      const project = store.projects.find(work.projectId);
      if (project === undefined) {
        throw new ProtocolError('NOT_FOUND', `Project ${work.projectId} is not open`);
      }
      if (store.runs.find(runId) === undefined) {
        throw new ProtocolError('NOT_FOUND', `Run ${runId} does not exist`);
      }
      return { root: project.root, taskWorktree: false };
    },
    // The project-root fallback owns no worktree, so there is no lease to release: saying
    // `false` is the honest answer rather than pretending one was handed back.
    release: () => false,
  };
}

export interface ToolHandlerOptions {
  readonly store: ProjectStore;
  readonly broker: Broker;
  readonly artifacts: ArtifactService;
  /**
   * The Grant/permission service (`protocol.md` §4 `permission.request`, T3.4).
   *
   * Injected rather than constructed here so the daemon's cancel path, the attempt-end
   * cleanup and this handler all revoke through one store.
   */
  readonly grantService: ToolGrantService;
  /**
   * The Attempt read ledgers (`AC-085`).
   *
   * Every evidence read through the bridge is recorded here and every answer carries the
   * resulting binding, so the Runner reports the real `readLedgerSeq`/`readLedgerHash` and
   * `stage.submit` can recompute them. Absent means this daemon cannot satisfy AC-085 for
   * bridge reads; the endpoints then run as before (registered gap).
   */
  readonly readLedgers?: ReadLedgerRegistry;
  /**
   * The credential store, for tool-audience secret injection (`AC-051`).
   *
   * A shell call receives the values of the refs the Run holds a `secret` Grant for, and
   * nothing else: the Grant is the authorization, `SecretStore` re-checks the audience and
   * the Run's identity, and a refused resolution stops the call instead of running it
   * without the credential it was promised.
   */
  readonly secrets?: SecretStore;
  /**
   * The Plan gate a source write must pass (`docs/rules/workflow.md` §7, AC-013).
   *
   * A `write`/`edit` is admitted only through `PlanGateService.requestCodeWrite`, which
   * refuses with `GATE_NOT_READY` when the Work froze no `baseRevision` or has no approved
   * Plan for it, with `VALIDATION_ERROR` for a stale revision, and with `INVALID_STATE`
   * while the Work is paused/cancelling. The gate is **fail-closed**: a daemon that has
   * not wired one yet refuses a source write rather than letting an unapproved edit
   * through, which is exactly the AC-013 promise ("无批准Plan的代码写请求→
   * GATE_NOT_READY且源码Hash不变").
   */
  readonly planGate?: PlanGateService;
  readonly workspace?: RunWorkspaceResolver;
  /**
   * The execution base for tool shells.
   *
   * `docs/architecture/execution.md` §1 makes the **host** the default for every permission
   * mode, and `executionModeForPermissionMode` is what the daemon resolves; this option
   * exists so a stack can explicitly opt into the optional container run environment. The
   * default is `host`, and the Broker's container branch still refuses without Docker rather
   * than silently downgrading an explicit container request.
   */
  readonly mode?: 'host' | 'container';
  /**
   * The effective sensitive-file tier for this project (`T3-implementation.md` 附录 A.7).
   *
   * It is read from the Project's own policy at assembly, exactly like `permissionMode`, so
   * one project's `test` tier cannot loosen another's. Absent means the global default
   * `strict`: a daemon that never resolved a tier refuses the whole frozen list rather
   * than opening it.
   */
  readonly configPolicy?: ConfigPolicy;
  /**
   * The Project policy revision the tier was resolved from (`context.preview` reports the
   * same value). Recorded on every allowed-but-listed read so the audit says which policy
   * the allowance belonged to (附录 A.7 配套三条-3).
   */
  readonly policyRevision?: number;
  /** The single-writer lease TTL; every call renews it (`LIMITS.leaseSec`). */
  readonly leaseTtlMs?: number;
  readonly now?: () => string;
  /** Reports the Q-T3-8 gap once per handler, for the daemon log. */
  readonly log?: (line: string) => void;
}

/** The `read` tool result's content as text; a non-string is the empty string. */
function readContentOf(result: unknown): string {
  if (typeof result !== 'object' || result === null) return '';
  const content = (result as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

/**
 * The execution base a permission policy selects (`execution.md` §1).
 *
 * **Every permission mode runs on the host.** Workspace, Autonomous and Full Access all run
 * professional Agents and their tools directly in the user's repository (or the Task's own
 * worktree); a missing Docker install costs the coding path nothing, and no permission mode
 * maps to a container. The container is an optional *project run environment* — reached only
 * by an explicit `mode: 'container'` on a call (or a stack assembled with that explicit
 * default), never by a policy — so this function is the whole documented default and is a
 * pure function so it can be asserted directly.
 */
export function executionModeForPermissionMode(
  _mode: 'workspace' | 'autonomous' | 'full_access',
): 'host' {
  // The parameter is kept because the documented mapping is stated per permission mode and
  // asserting it is what proves no mode selects the container; the host is the answer for
  // all three.
  return 'host';
}

/** The resource name of one Work's single-writer lease (`reliability.md` §3). */
export function workWriterLeaseResource(projectId: string, workId: string): string {
  return `workspace:${projectId}:${workId}`;
}

/**
 * The artifact kind an `artifact_write` produces.
 *
 * `evidence` is the card kind for a report/检查 result, which is what a Run writes with
 * this tool today; a richer mapping (product/plan/diff by purpose) belongs to the
 * artifact slice, so it is not guessed here.
 */
const ARTIFACT_WRITE_KIND: ArtifactKind = 'evidence';

/**
 * Both Runner-facing tool methods: `tool.execute` and `permission.request`.
 *
 * They share one object because they share the same resolution of "which Run is this
 * capability, and which Work authorizes it" — splitting them would duplicate the identity
 * checks that make the permission binding trustworthy.
 */
export interface ToolHandler extends ToolExecuteHandler, PermissionRequestHandler {}

/**
 * Builds the handler the control endpoint calls.
 *
 * Every refusal is a `ProtocolError`, so `tool-http.ts` maps one code to one HTTP status
 * and the Runner receives the documented vocabulary (`protocol.md` §7).
 */
export function createToolHandler(options: ToolHandlerOptions): ToolHandler {
  const { store, broker, artifacts, planGate, grantService, readLedgers, secrets } = options;
  const now = options.now ?? (() => store.now());
  const policyMode = options.mode ?? 'host';
  const configPolicy: ConfigPolicy = options.configPolicy ?? 'strict';
  const policyRevision = options.policyRevision ?? 0;
  const leaseTtlMs = options.leaseTtlMs ?? LIMITS.leaseSec.default * 1000;
  const workspace = options.workspace ?? createProjectRootWorkspaceResolver(store);
  const log = options.log ?? ((): void => undefined);
  let reportedGap = false;

  /**
   * Files the user-facing todo one refused sensitive file produces (附录 A.1-3).
   *
   * `chief_action_required` is the Chief todo mechanism the Inbox already renders
   * (`rules/agents.md` §3), so no second mechanism is invented; `kind` distinguishes
   * these rows from a context expansion or a dispatch request. Idempotent per
   * `(work, path, pattern)`: a model that retries the same refusal does not accumulate
   * todos, and the refusal text tells it not to retry anyway.
   */
  function fileSensitiveTodo(input: {
    readonly workId: string;
    readonly runId: string;
    readonly role: Role;
    readonly path: string;
    readonly pattern: string;
    readonly action: string;
  }): number {
    const operationId = `sensitive:${input.path}:${input.pattern}`;
    // Idempotency is read from the durable log itself. `EventStore` exposes `readAfter`
    // rather than a filtered query, so the one event name is selected with SQL and the
    // two data fields are compared here; a retried refusal therefore cannot accumulate
    // duplicate todos (the refusal text tells the model not to retry anyway).
    const rows = store.db
      .prepare(
        "SELECT data FROM event WHERE name = 'chief_action_required' AND entity_id = ? ORDER BY cursor DESC LIMIT 200",
      )
      .all(input.workId) as { data: string }[];
    const duplicate = rows.some((row) => {
      try {
        const data = JSON.parse(row.data) as Record<string, unknown>;
        return data['kind'] === SENSITIVE_FILE_TODO_KIND && data['operationId'] === operationId;
      } catch {
        return false;
      }
    });
    if (duplicate) return 0;
    const work = store.works.find(input.workId);
    if (work === undefined) return 0;
    const event = store.events.append({
      name: 'chief_action_required',
      entityId: work.id,
      entityVersion: work.version,
      data: {
        workId: work.id,
        runId: input.runId,
        role: input.role,
        kind: SENSITIVE_FILE_TODO_KIND,
        operationId,
        path: input.path,
        pattern: input.pattern,
        action: input.action,
        configPolicy,
        policyRevision,
        // 附录 A.1-3: the todo does not block the Run; it asks the user to handle the file.
        reason:
          '该文件在敏感文件表内，Agent 不会读/搜/改它；请你本人处理（填写/更新/提供替代值），Agent 会继续做其他工作',
      },
    });
    log(`tool-handler: sensitive-file todo filed for ${input.path} (${input.pattern})`);
    return event.cursor;
  }

  /** Asserts this Attempt is the Work's single writer, renewing the lease it holds. */
  function assertWriter(caller: ToolExecuteCaller, workId: string, projectId: string): void {
    const at = now();
    const expiresAt = new Date(Date.parse(at) + leaseTtlMs).toISOString();
    const resource = workWriterLeaseResource(projectId, workId);
    if (store.leases.renew(resource, caller.attemptId, caller.epoch, expiresAt, at)) return;
    const acquired = store.leases.acquire({
      resource,
      ownerAttemptId: caller.attemptId,
      epoch: caller.epoch,
      expiresAt,
      at,
    });
    if (!acquired.acquired) {
      throw new ProtocolError(
        'BUSY',
        `Work ${workId} is being written by attempt ${acquired.heldBy.ownerAttemptId}; this Attempt holds no writer lease`,
        { details: { resource, heldBy: acquired.heldBy.ownerAttemptId } },
      );
    }
  }

  /**
   * Resolves the tool-audience environment for one shell call (`AC-051`).
   *
   * The refs come from the Run's live `secret` Grants — the user-approved authorization —
   * and `SecretStore.environmentFor` re-checks the audience, the role and the Grant, so a
   * credential for another Run or the gateway audience can never appear here.
   */
  function resolveSecretEnv(input: {
    readonly runId: string;
    readonly workId: string;
    readonly role: Role;
    readonly stage: string;
    readonly purpose: Purpose;
    readonly toolOperationId: string;
    readonly input: unknown;
    readonly operation: string;
  }): Record<string, string> | undefined {
    if (secrets === undefined) return undefined;
    if (input.operation !== 'bash' && input.operation !== 'git') return undefined;
    const held = store.grants.list({
      where: 'run_id = ? AND consumed_at IS NULL',
      params: [input.runId],
    });
    const refs = [
      ...new Set(
        held.filter((grant) => grant.operation === 'secret').flatMap((grant) => grant.targets),
      ),
    ];
    if (refs.length === 0) return undefined;
    const injection = secrets.environmentFor(
      {
        audience: 'tool',
        purpose: input.purpose,
        role: input.role,
        workId: input.workId,
        stage: input.stage,
        at: now(),
        runId: input.runId,
        toolOperationId: input.toolOperationId,
        inputHash: hashToolInput(input.input),
        grants: held,
      },
      refs,
    );
    if (!injection.ok) {
      throw new ProtocolError(injection.code, injection.reason, {
        details: { fields: [...injection.fields] },
      });
    }
    return { ...injection.env };
  }

  return {
    execute: async ({ caller, request, signal }): Promise<ToolSuccess> => {
      const run = store.runs.find(caller.runId);
      if (run === undefined) {
        throw new ProtocolError('NOT_FOUND', `Run ${caller.runId} does not exist`);
      }
      if (run.role !== caller.role) {
        // The capability is the identity; a Run row that disagrees means the token and the
        // row were not minted together, so nothing is executed.
        throw new ProtocolError(
          'NOT_AUTHORIZED',
          `the capability role ${caller.role} does not match Run ${run.id} (${run.role})`,
        );
      }
      const work = store.works.find(run.workId);
      if (work === undefined) {
        throw new ProtocolError('NOT_FOUND', `Work ${run.workId} does not exist`);
      }
      // `reliability.md` §3 keeps one **writer** per Work: the lease belongs to an Attempt
      // whose role may modify the workspace (`agents.md` §1 gives `edit` to
      // backend/frontend/settlement only). A read-only role — the Chief, and the
      // Product/Plan/Review/Test stages — does not write the tree, and taking the lease for
      // it made the Chief's own turn block the child Run it had just dispatched: the
      // Planning Run's first `artifact_write` was refused `BUSY … this Attempt holds no
      // writer lease` while the Chief was still streaming and renewing the lease with every
      // read, and a real model then reported `needs_input` instead of retrying (WP-12 W4c).
      // Every role that can write still serialises through the same row.
      if (roleHasBrokerTool(caller.role, 'edit')) {
        assertWriter(caller, work.id, work.projectId);
      }

      const root = workspace.resolve({
        workId: work.id,
        runId: run.id,
        attemptId: caller.attemptId,
        epoch: caller.epoch,
      });
      const runRef = { id: run.id, workId: run.workId, role: run.role };
      if (!root.taskWorktree && run.taskId !== undefined && !reportedGap) {
        // A Task Run without a worktree means the resolver is the fallback: say so once,
        // because that is the difference between "isolated per Task" and "shared root".
        reportedGap = true;
        log(
          `tool-handler: Run ${run.id} (Task ${run.taskId}) is using the project root; no per-Task worktree resolver is wired into this stack`,
        );
      }

      const planned = planToolCall({
        toolName: request.toolName,
        args: request.args,
        cwdRoot: root.root,
        role: caller.role,
        configPolicy,
      });
      if (!planned.ok) {
        // 附录 A.1-3/A.2: a refused sensitive file becomes a **todo**, not a blocker. The
        // typed refusal is returned to the model (which is told not to retry) while the
        // user is asked to handle the file, and the Run keeps working on everything else.
        if (planned.sensitive !== undefined) {
          fileSensitiveTodo({
            workId: work.id,
            runId: run.id,
            role: runRef.role,
            path: planned.sensitive.path,
            pattern: planned.sensitive.pattern,
            action: planned.sensitiveAction ?? 'read',
          });
        }
        throw new ProtocolError(planned.code, planned.reason, {
          details: {
            toolName: request.toolName,
            ...(planned.sensitiveAction === undefined ? {} : { action: planned.sensitiveAction }),
            ...(planned.sensitive === undefined
              ? {}
              : { pattern: planned.sensitive.pattern, path: planned.sensitive.path }),
            configPolicy,
            policyRevision,
            approvable: planned.approvable,
            ...(planned.refusalPaths === undefined ? {} : { paths: [...planned.refusalPaths] }),
          },
        });
      }
      const plan = planned.plan;
      const args = request.args;
      // A model-supplied JSON member read as text; a non-string is the empty string, never
      // an object stringified as "[object Object]".
      const text = (value: unknown): string => (typeof value === 'string' ? value : '');

      // 附录 A.1-1: an address the call names literally is decided by the same policy the
      // Broker uses for an explicit `network` operation — loopback, private, link-local,
      // CGNAT, metadata space and the daemon's own ports are refused before execution, so
      // the model gets the typed refusal instead of a transport error the broker never saw.
      if (plan.network !== undefined) {
        const policy = broker.egressPolicy();
        for (const url of plan.network) {
          const decision = await policy.decide({ url });
          if (decision.ok) continue;
          throw new ProtocolError('CONTEXT_FORBIDDEN', decision.reason, {
            details: {
              toolName: plan.toolName,
              network: url,
              approvable: false,
              configPolicy,
              policyRevision,
            },
          });
        }
      }

      // AC-013: a source write passes the Plan gate before anything runs. The gate is the
      // authority on "there is an approved Plan for the tree this write targets"; the
      // Broker below is the authority on the Grant, the roots and the role gate.
      if (plan.toolName === 'write' || plan.toolName === 'edit') {
        if (planGate === undefined) {
          throw new ProtocolError(
            'GATE_NOT_READY',
            'no Plan gate is wired into this daemon; a source write cannot be admitted',
            { details: { toolName: plan.toolName } },
          );
        }
        const verdict = planGate.requestCodeWrite({
          workId: work.id,
          revision: work.baseRevision ?? '',
          targets: plan.targets,
        });
        if (!verdict.allowed) {
          throw new ProtocolError(verdict.code, verdict.message, {
            details: { toolName: plan.toolName, gaps: [...verdict.gaps] },
          });
        }
      }

      // `context.md` §1: an appended read may only happen inside the Run's frozen
      // `readScope`; a wider read "由 context.request 返回 Chief 处理，授权未完成不读取". The
      // Broker's Grant answers a *different* question (the Work's authorization), so the
      // bridge refuses the call **here**, before any file content exists, and records the
      // request in the same ledger (`AC-032`). Admitting it and only logging the ledger
      // refusal would hand the model material the delivery's seal cannot cover.
      if (readLedgers !== undefined && (plan.operation === 'read' || plan.operation === 'search')) {
        const target = plan.targets[0] ?? '';
        const admitted = readLedgers.admitsPath({
          attemptId: caller.attemptId,
          runId: run.id,
          role: runRef.role,
          stage: run.stage,
          ...(work.baseRevision === undefined ? {} : { revision: work.baseRevision }),
          path: target,
        });
        if (!admitted.ok) {
          readLedgers.recordOutOfScope({
            attemptId: caller.attemptId,
            runId: run.id,
            role: runRef.role,
            stage: run.stage,
            ...(work.baseRevision === undefined ? {} : { revision: work.baseRevision }),
            path: target,
            reason: `${admitted.code}: ${admitted.message}`,
          });
          throw new ProtocolError(
            admitted.code,
            `${admitted.message}；越范围读取需经 context.request 由 Chief 处理（context.md §1）`,
            { details: { toolName: plan.toolName, path: target } },
          );
        }
      }

      // The executor Core owns. The Broker's own built-ins cover `write`/`bash`/`git`; the
      // three below are the tools whose real behaviour is a per-target read, a bounded walk
      // or a pre-image-guarded write, and `artifact_write` is a domain tool
      // (`execution.md` §2) that must not be mistaken for a file write.
      const body = (() => {
        if (plan.toolName === 'artifact_write') {
          const mime = typeof args['mime'] === 'string' ? args['mime'] : 'text/plain';
          return () => {
            const artifact = artifacts.createAgent({
              run: runRef,
              kind: ARTIFACT_WRITE_KIND,
              mime,
              bytes: Buffer.from(text(args['content']), 'utf8'),
            });
            return {
              artifactId: artifact.id,
              mime: artifact.mime,
              bytes: artifact.bytes,
              contentHash: artifact.contentHash,
              logicalPath: text(args['path']),
            };
          };
        }
        if (plan.toolName === 'read')
          return (context: Parameters<typeof runReadTool>[0]) => runReadTool(context, args);
        if (plan.toolName === 'search') {
          return (context: Parameters<typeof runSearchTool>[0]) => runSearchTool(context, args);
        }
        if (plan.toolName === 'edit') {
          return (context: Parameters<typeof runEditTool>[0]) => runEditTool(context, args);
        }
        return plan.run;
      })();

      // `AC-051`: a shell call gets the tool-audience secrets its Run holds a Grant for.
      const secretEnv = resolveSecretEnv({
        runId: run.id,
        workId: work.id,
        role: runRef.role,
        stage: run.stage,
        purpose: run.purpose,
        toolOperationId: request.toolOperationId,
        input: plan.input,
        operation: plan.operation,
      });

      // `execution.md` §1 / `agents.md` §1: **every** role runs on the host by default,
      // Review and Test included. Their independence comes from a distinct Run, Session,
      // frozen input and tool set, not from a container mount; the container is an optional
      // project run environment reached only through the explicit stack mode.
      const callMode = policyMode;

      const outcome = await broker.invoke({
        workId: work.id,
        runId: run.id,
        attemptId: caller.attemptId,
        epoch: caller.epoch,
        role: runRef.role,
        stage: run.stage,
        operation: plan.operation,
        // An `artifact_write` is content-addressed in Core's `ArtifactService` and never
        // touches the filesystem (`execution.md` §2: Core handles that domain tool
        // directly), so the logical `path` it carries is a label, not a boundary. Sending
        // it as a target made the tool subject to the *source* write envelope — a Planning
        // Run whose Work authorizes only `src/orders/cancel.ts` could not store a Plan
        // artifact under `plan.json` (`NOT_AUTHORIZED: target plan.json is outside the
        // grant`), which is the dead end the L2 route hit (WP-12 W4b). Every other
        // operation still passes its real targets through unchanged.
        targets: plan.toolName === 'artifact_write' ? [] : plan.targets,
        input: plan.input,
        // The endpoint's operation id is the ledger key: the Broker records the
        // `tool_operation` under it and replays the recorded result when the Runner retries
        // the same call (`reliability.md` §2). Letting the Broker generate a fresh id here
        // would make every retry a new operation instead of a replay (T3 integration test).
        toolOperationId: request.toolOperationId,
        mode: callMode,
        roots: [root.root],
        // 附录 A.1-2: deleting inside the workspace is allowed and Git / the per-Task
        // workspace / the delivery CAS are the backstop. A container mount is `rw` only for
        // a path in `writableRoots`, and the daemon never passed one, so a Developer Run's
        // write tools used to fail against a read-only mount (`INTERNAL_ERROR`). A mutating
        // role's own workspace root is the writable one; Review/Test keep their separate
        // report/scratch roots and are never handed the source tree as writable.
        ...(callIsReadOnly(caller.role) ? {} : { writableRoots: [root.root] }),
        // 附录 A.7: the tier travels with the call so a directory search skips the frozen
        // list at the point of reading.
        configPolicy,
        ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
        ...(body === undefined ? {} : { run: body }),
        timeoutMs: request.timeoutMs,
        ...(secretEnv === undefined ? {} : { secretEnv }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!outcome.ok) {
        // `AC-032`/`AC-085`: a refused read is recorded in the ledger too, so a delivery
        // cannot hide that it asked for material outside its scope.
        if (
          readLedgers !== undefined &&
          outcome.code === 'NOT_AUTHORIZED' &&
          (plan.operation === 'read' || plan.operation === 'search')
        ) {
          readLedgers.recordOutOfScope({
            attemptId: caller.attemptId,
            runId: run.id,
            role: runRef.role,
            stage: run.stage,
            ...(work.baseRevision === undefined ? {} : { revision: work.baseRevision }),
            path: plan.targets[0] ?? '',
            reason: `${outcome.code}: ${outcome.reason}`,
          });
        }
        throw new ProtocolError(outcome.code, outcome.reason, {
          details: {
            toolOperationId: outcome.toolOperationId,
            fields: [...outcome.fields],
            // The phase-1 boundary refusals are final: a loopback/metadata target, an
            // outside-workspace delete or a Git-ref change is **not** something a user
            // decision could admit, so the Runner must not open a permission request for
            // it (`T3-implementation.md` 附录 A.1). Only the environment operations the
            // approval chain exists for carry `approvable: true`.
            approvable: requiresPerOccurrenceApproval(plan.operation),
            configPolicy,
            policyRevision,
          },
        });
      }
      // 附录 A.7 配套三条-3: an allowance is not a silence. In `test` tier a read/search/edit
      // of a listed application-config file is admitted, and this is where that allowance is
      // audited — path, the policy revision it was granted under, and the tier itself — so a
      // test-environment relaxation cannot hide a real leak. The row is written **before**
      // the read-ledger branch below returns, so a ledgered read and an unledgered one are
      // audited alike.
      if (configPolicy !== 'strict' && plan.targets.length > 0) {
        for (const target of plan.targets) {
          const match = matchSensitiveFile(target);
          if (match === undefined) continue;
          store.events.append({
            name: 'tool.listed_file_allowed',
            entityId: outcome.toolOperation.id,
            entityVersion: outcome.toolOperation.version,
            data: {
              workId: work.id,
              runId: run.id,
              role: runRef.role,
              operation: plan.operation,
              path: match.path,
              pattern: match.pattern,
              configPolicy,
              policyRevision,
              allowedBy: 'application_config',
            },
          });
        }
      }
      // `AC-085`: record what this call really read, then carry the Attempt's binding back
      // so the Runner can report it in `stage_yield`.
      if (readLedgers !== undefined && (plan.operation === 'read' || plan.operation === 'search')) {
        const recorded = readLedgers.record({
          attemptId: caller.attemptId,
          runId: run.id,
          role: runRef.role,
          stage: run.stage,
          ...(work.baseRevision === undefined ? {} : { revision: work.baseRevision }),
          path: plan.targets[0] ?? '',
          reason: `${plan.toolName}: ${outcome.toolOperation.id}`,
          content:
            plan.operation === 'read'
              ? readContentOf(outcome.result)
              : JSON.stringify(outcome.result ?? null),
        });
        if (!recorded.ok) {
          // A read the Broker admitted but the ledger cannot name makes the ledger
          // **incomplete**: material entered the model's context that the seal would not
          // cover. Mark the Attempt unverifiable so `stage.submit` refuses to certify an
          // empty (or partial) binding over reads that really happened, instead of
          // accepting a claim Core cannot confirm (`AC-085`; the T3b vertical drill found
          // this path when the read was inside the Work's authorization but outside the
          // Run's `(role, stage)` read scope).
          readLedgers.markUnverifiable(
            caller.attemptId,
            `a read the bridge admitted could not be recorded: ${recorded.message}`,
          );
          log(
            `tool-handler: read ledger append failed for ${caller.attemptId}: ${recorded.message}`,
          );
        }
        return { ...outcome, ledger: { ...readLedgers.binding(caller.attemptId) } };
      }
      return outcome;
    },

    /**
     * `permission.request` — records the user decision a refused call needs (`protocol.md` §4).
     *
     * The operation comes from the shared tool catalog, so a Runner cannot ask for authority
     * over a tool name the role does not hold; the `toolOperationId`/`inputHash` are the ones
     * the Runner used for the refused `tool.execute`, and the Grant that a later approval
     * mints is bound to exactly those values (`security review G1.2`).
     */
    request: ({ caller, toolName, args, toolOperationId, inputHash }): JsonObject => {
      const run = store.runs.find(caller.runId);
      if (run === undefined) {
        throw new ProtocolError('NOT_FOUND', `Run ${caller.runId} does not exist`);
      }
      if (run.role !== caller.role) {
        throw new ProtocolError(
          'NOT_AUTHORIZED',
          `the capability role ${caller.role} does not match Run ${run.id} (${run.role})`,
        );
      }
      const work = store.works.find(run.workId);
      if (work === undefined) {
        throw new ProtocolError('NOT_FOUND', `Work ${run.workId} does not exist`);
      }
      const planned = planToolCall({
        toolName,
        args,
        cwdRoot: workspace.resolve({
          workId: work.id,
          runId: run.id,
          attemptId: caller.attemptId,
          epoch: caller.epoch,
        }).root,
        role: caller.role,
        configPolicy,
      });
      if (!planned.ok) {
        throw new ProtocolError(planned.code, planned.reason, {
          details: {
            toolName,
            approvable: planned.approvable,
            ...(planned.sensitiveAction === undefined ? {} : { action: planned.sensitiveAction }),
            ...(planned.sensitive === undefined
              ? {}
              : { pattern: planned.sensitive.pattern, path: planned.sensitive.path }),
            configPolicy,
            policyRevision,
          },
        });
      }
      // The binding an approval later mints from must be **durable before the user sees the
      // request**. For an environment operation the Broker refused, no `tool_operation` row
      // was ever written — a refusal is not an execution — so the request itself records one.
      // Priority is explicit: a row that already exists is the operation the Broker really
      // keyed and wins; only when there is none does the request's own binding (the Runner
      // just attempted exactly this call) become the record.
      const recorded = store.toolOperations.find(toolOperationId);
      if (recorded !== undefined && recorded.inputHash !== inputHash) {
        throw new ProtocolError(
          'IDEMPOTENCY_CONFLICT',
          `tool operation ${toolOperationId} is recorded with a different input hash`,
          { details: { toolOperationId, operation: recorded.toolName } },
        );
      }
      if (recorded === undefined) {
        store.toolOperations.insert({
          id: toolOperationId,
          workId: work.id,
          runId: run.id,
          attemptId: caller.attemptId,
          epoch: caller.epoch,
          toolName: planned.plan.toolName,
          inputHash,
          argsRef: toolOperationId,
          targets: [...planned.plan.targets],
          state: 'prepared',
          // No `grantId`: this row is a refusal record kept for the approval, not an
          // operation that was prepared for execution (`GrantStore.prepareOperation`).
        });
      }
      const decided = grantService.requestPermission({
        workId: work.id,
        runId: run.id,
        role: run.role,
        stage: run.stage,
        operation: recorded?.toolName ?? planned.plan.operation,
        targets: recorded === undefined ? [...planned.plan.targets] : [...recorded.targets],
        toolOperationId,
        inputHash: recorded?.inputHash ?? inputHash,
        expiresAt: new Date(
          Date.parse(now()) + LIMITS.workActiveTimeSec.default * 1000,
        ).toISOString(),
      });
      return {
        status: 'waiting_permission',
        decisionId: decided.decisionId,
        version: decided.version,
        workId: work.id,
        runId: run.id,
        operation: planned.plan.operation,
        runStatus: decided.runStatus ?? 'waiting_permission',
      };
    },
  };
}
