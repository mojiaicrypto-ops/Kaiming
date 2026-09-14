/**
 * The tool Grant and permission lifecycle: minting, approval, revocation (T3.4).
 *
 * `docs/architecture/data.md` §2 fixes the `grant` and `decision` rows, and
 * `docs/delivery/acceptance.md` fixes the observable promise this module owes:
 *
 * - **AC-049** — a Run may continue inside its authorized scope and must stop for a user
 *   decision outside it ("范围内继续，超范围权限决定");
 * - **AC-080** — a `once` Grant is bound to its exact tool operation and input hash and is
 *   consumed atomically;
 * - **AC-013** (with the T3 Q-T3-4 decision) — a code write has a Grant citing the
 *   `decisionId` that authorized it.
 *
 * Two sources of authority exist and this module is the **only** production caller of
 * `GrantStore.issue` (the security review found none before):
 *
 * 1. **File-scope Grants at Attempt start.** `ensureRunGrants` reads the Work's own scope
 *    plus its non-revoked `authorization` rows and mints one `run`-scope Grant per file
 *    operation (`read`/`search`/`edit`/`write`/`artifact_write`). This is the "Workspace
 *    allows reading authorized source and writing the Task workspace" half of
 *    `execution.md` §15: an approved Plan/authorization is the Grant's basis, which is why
 *    every minted row carries a real `decisionId`.
 * 2. **Environment operations are per-occurrence.** `bash`, `network`, `secret`, `push`,
 *    `deploy` and `delete_data` (T3 Q-T3-3) never come from the automatic set. They go
 *    through `requestPermission` → a pending `permission` Decision → `approvePermission`,
 *    which mints a `once` Grant bound to `(runId, toolOperationId, inputHash)`. This is the
 *    `permission.request`/`permission.respond` chain `protocol.md` §4 documents; the
 *    protocol registration itself is the daemon's (a T2-owned file), and the service here
 *    is what that handler calls.
 *
 * The service never widens a Work envelope: `GrantStore.issue` re-validates every mint
 * request against the Work scope, so a permission approval cannot authorize an operation
 * or path the Work (plus its authorizations) never had.
 */
import { canonicalJson, type Decision, type Grant, type Role } from '@agentdev/contracts';
import { canTransitionRun } from '@agentdev/domain';
import {
  sha256,
  withTransaction,
  type EntityRepository,
  type ProjectStore,
} from '@agentdev/storage';
import { ProtocolError } from './errors.js';
import { permissionBindingHash, type GrantStore } from './grants.js';

/** The event one decided permission emits (`protocol.md` §7 `permission.resolved`). */
export const PERMISSION_EVENTS = {
  resolved: 'permission.resolved',
} as const;

/** The file operations an Attempt receives automatically from its authorization. */
export const RUN_FILE_OPERATIONS: readonly string[] = [
  'read',
  'search',
  'edit',
  'write',
  'artifact_write',
];

/**
 * Operations that always require a per-occurrence user decision (T3 Q-T3-3).
 *
 * File read/write is covered by the Run's Grant, which is derived from the approved
 * Plan/authorization; these operations reach outside the repository (a shell, a network
 * target, a secret, a publish, a deployment, a data deletion), so each occurrence needs
 * its own approval. `git` is absent because the tool exposes read-only subcommands only
 * (`execution.md` §7) and its delivery-ref half belongs to the Workspace service.
 *
 * The set mirrors `orchestrator.ts`'s derived-authorization `ENVIRONMENT_OPERATIONS`
 * exactly. It is restated here rather than imported so this module's policy does not
 * depend on a file another lane holds open; consolidating the two constants is a
 * follow-up for the assembly step.
 */
export const PERMISSION_OPERATIONS: readonly string[] = [
  'bash',
  'network',
  'secret',
  'push',
  'deploy',
  'delete_data',
];

/** Whether an operation must be approved per occurrence rather than by the run Grant. */
export function requiresPerOccurrenceApproval(operation: string): boolean {
  return PERMISSION_OPERATIONS.includes(operation);
}

export interface ToolGrantServiceOptions {
  readonly store: ProjectStore;
  readonly grants: GrantStore;
  readonly now?: () => string;
}

/** What one Attempt asks for when it starts. */
export interface EnsureRunGrantsInput {
  readonly workId: string;
  readonly runId: string;
  readonly role: Role;
  readonly stage: string;
  /** When the run-scope Grants expire; normally the Attempt deadline plus a grace. */
  readonly expiresAt: string;
  /** Limits copied onto every minted Grant (Q-T3-1's inline ceiling uses memory, not this). */
  readonly limits?: Readonly<Record<string, unknown>>;
}

export interface EnsureRunGrantsResult {
  readonly ok: boolean;
  /** Grants that now exist for the Run, minted or already present. */
  readonly grants: readonly Grant[];
  readonly created: number;
  readonly existing: number;
  /** The Decision every minted Grant cites. */
  readonly decisionId: string;
  /** Why nothing could be minted, when `ok` is false. */
  readonly reason?: string;
}

export interface PermissionRequestInput {
  readonly workId: string;
  readonly runId: string;
  readonly role: Role;
  readonly stage: string;
  readonly operation: string;
  readonly targets: readonly string[];
  readonly toolOperationId: string;
  readonly inputHash: string;
  /** `once` (default) or `run` when the user chose "allow for this run". */
  readonly scope?: 'once' | 'run';
  readonly expiresAt: string;
  readonly limits?: Readonly<Record<string, unknown>>;
}

export interface PermissionDecisionResult {
  readonly decisionId: string;
  readonly version: number;
  readonly state: 'pending' | 'accepted' | 'rejected';
  readonly blockerAttached: boolean;
  /** Present after an approval: the Grant the next identical call will be admitted by. */
  readonly grant?: Grant;
  /**
   * The Run's status after the decision, when the request named one.
   *
   * A request parks the Run in `waiting_permission` and a decision returns it to
   * `running` (`domain/transitions.ts` allows both edges); `undefined` means the service
   * had no Run to move or the transition was already the target.
   */
  readonly runStatus?: string;
}

export class ToolGrantService {
  private readonly store: ProjectStore;
  private readonly grants: GrantStore;
  private readonly now: () => string;
  private readonly decisions: EntityRepository<Decision>;

  constructor(options: ToolGrantServiceOptions) {
    this.store = options.store;
    this.grants = options.grants;
    this.now = options.now ?? (() => options.store.now());
    this.decisions = options.store.decisions;
  }

  // -------------------------------------------------------------------------
  // Run-scope Grants (source 1)
  // -------------------------------------------------------------------------

  /**
   * Mints (or reuses) the Run's file-scope Grants from the Work's authorization.
   *
   * Idempotent: a Grant already carrying the same `(work, run, role, stage, operation)`
   * is counted, not duplicated, so a retried Attempt start does not accumulate authority.
   */
  ensureRunGrants(input: EnsureRunGrantsInput): EnsureRunGrantsResult {
    const work = this.store.works.find(input.workId);
    if (work === undefined) {
      return {
        ok: false,
        grants: [],
        created: 0,
        existing: 0,
        decisionId: '',
        reason: `Work ${input.workId} does not exist`,
      };
    }
    const paths = this.authorizedPaths(work.id, work.scope);
    const decisionId = this.authorizationDecision(work.id);
    if (decisionId === '') {
      return {
        ok: false,
        grants: [],
        created: 0,
        existing: 0,
        decisionId: '',
        reason: `Work ${work.id} has no authorization decision to cite; no Grant can be issued`,
      };
    }
    const current = this.grants.currentRunGrants(input.runId);
    const minted: Grant[] = [];
    let created = 0;
    let existing = 0;
    let reason: string | undefined;
    for (const operation of RUN_FILE_OPERATIONS) {
      const targets = operation === 'read' || operation === 'search' ? paths.all : paths.write;
      if (targets.length === 0) continue;
      if (current.some((grant) => grant.operation === operation && grant.role === input.role)) {
        existing += 1;
        continue;
      }
      const outcome = this.grants.issue({
        workId: work.id,
        role: input.role,
        stage: input.stage,
        scope: 'run',
        operation,
        targets,
        runId: input.runId,
        decisionId,
        expiresAt: input.expiresAt,
        limits: input.limits ?? {},
      });
      if (outcome.ok) {
        minted.push(outcome.grant);
        created += 1;
      } else if (reason === undefined) {
        reason = `${outcome.code}: ${outcome.reason}`;
      }
    }
    const grants = [...current, ...minted];
    if (created === 0 && existing === 0) {
      return {
        ok: false,
        grants,
        created,
        existing,
        decisionId,
        reason: reason ?? `Work ${work.id} authorizes no file path for role ${input.role}`,
      };
    }
    return {
      ok: true,
      grants,
      created,
      existing,
      decisionId,
      ...(reason === undefined ? {} : { reason }),
    };
  }

  /** The Work's authorized paths, unioned with its non-revoked authorizations. */
  private authorizedPaths(
    workId: string,
    declared: { readonly readPaths: readonly string[]; readonly writePaths: readonly string[] },
  ): { all: string[]; write: string[] } {
    const read = new Set(declared.readPaths);
    const write = new Set(declared.writePaths);
    for (const authorization of this.store.authorizations.list({
      where: 'work_id = ?',
      params: [workId],
    })) {
      if (authorization.revokedAt !== undefined) continue;
      for (const path of authorization.scope.readPaths) read.add(path);
      for (const path of authorization.scope.writePaths) write.add(path);
    }
    return { all: [...new Set([...read, ...write])], write: [...write] };
  }

  /**
   * The Decision a run-scope Grant cites (`grant.decision_id` is a foreign key).
   *
   * Preference order: an authorization row that already names a Decision; any accepted
   * Decision already recorded for the Work; otherwise one `start` Decision is recorded
   * with the Work's own `sourceRef` as its target. That row is what makes "the user
   * authorized this Work" auditable, and it is created here rather than invented by a
   * caller.
   */
  private authorizationDecision(workId: string): string {
    for (const authorization of this.store.authorizations.list({
      where: 'work_id = ?',
      params: [workId],
    })) {
      if (authorization.revokedAt !== undefined) continue;
      if (authorization.sourceRef.kind !== 'decision') continue;
      if (this.decisions.find(authorization.sourceRef.id) !== undefined) {
        return authorization.sourceRef.id;
      }
    }
    const existing = this.decisions
      .list({ where: 'work_id = ?', params: [workId], orderBy: 'created_at ASC' })
      .find((decision) => decision.kind !== 'permission' && decision.state === 'accepted');
    if (existing !== undefined) return existing.id;
    const work = this.store.works.find(workId);
    if (work === undefined) return '';
    const created = this.decisions.insert({
      projectId: work.projectId,
      workId,
      kind: 'start',
      targetRef: {
        id: work.id,
        version: work.version,
        hash: sha256(canonicalJson(work.sourceRef)),
      },
      choices: ['authorized'],
      state: 'accepted',
      choice: 'authorized',
      actor: 'user',
      effectRefs: [],
    });
    return created.id;
  }

  // -------------------------------------------------------------------------
  // Per-occurrence permission (source 2)
  // -------------------------------------------------------------------------

  /**
   * Records a pending `permission` Decision for one environment operation.
   *
   * The binding is **not** trusted from the caller's prose: `toolOperationId` and
   * `inputHash` are the exact values the refused `tool.execute` carried, and the approval
   * mints a `once` Grant from those values, so approving one call cannot authorize a
   * different one. The Work gains the Decision as a blocker (the Inbox renders it); the
   * Run's own status change belongs to the Run lifecycle in the daemon slice, so it is
   * not written here.
   */
  requestPermission(input: PermissionRequestInput): PermissionDecisionResult {
    const work = this.store.works.find(input.workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${input.workId} does not exist`);
    }
    if (input.inputHash.trim() === '' || input.toolOperationId.trim() === '') {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        'a permission request must name the tool operation and input hash it is about',
      );
    }
    const decision = this.decisions.insert({
      projectId: work.projectId,
      workId: work.id,
      kind: 'permission',
      targetRef: {
        id: input.toolOperationId,
        version: 1,
        // The exact binding the eventual Grant must reproduce (`grants.ts`
        // `permissionBindingHash`); it is what makes an approval un-repointable.
        hash: permissionBindingHash({
          operation: input.operation,
          targets: input.targets,
          toolOperationId: input.toolOperationId,
          inputHash: input.inputHash,
        }),
      },
      choices: ['approve', 'deny'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    const attached = this.attachBlocker(work.id, decision.id);
    this.store.events.append({
      name: 'decision.created',
      entityId: decision.id,
      entityVersion: decision.version,
      data: { workId: work.id, kind: 'permission', operation: input.operation },
    });
    // The Run waits rather than fails (`domain/transitions.ts` `running →
    // waiting_permission`): a refusal the user can resolve is not an error state, and the
    // model must not be told the operation succeeded.
    const waiting = this.moveRun(input.runId, 'waiting_permission');
    return {
      decisionId: decision.id,
      version: decision.version,
      state: 'pending',
      blockerAttached: attached,
      ...(waiting === undefined ? {} : { runStatus: waiting }),
    };
  }

  /**
   * Applies an approval: resolves the Decision and mints the bound `once`/`run` Grant.
   *
   * `choice` must be one of the Decision's own choices, and the Decision must still be
   * pending, so a second approval cannot mint a second Grant.
   */
  approvePermission(input: {
    readonly decisionId: string;
    readonly operation: string;
    readonly runId: string;
    readonly role: Role;
    readonly stage: string;
    readonly targets: readonly string[];
    readonly toolOperationId: string;
    readonly inputHash: string;
    readonly expiresAt: string;
    readonly scope?: 'once' | 'run';
    readonly limits?: Readonly<Record<string, unknown>>;
  }): PermissionDecisionResult {
    const decision = this.pendingPermission(input.decisionId);
    const work = this.store.works.find(decision.workId);
    if (work === undefined) {
      throw new ProtocolError('NOT_FOUND', `Work ${decision.workId} does not exist`);
    }
    // The Decision is resolved to `accepted` **before** the Grant is minted, inside one
    // transaction: the mint only widens the Work envelope for an already-accepted permission
    // decision (`grants.ts` `issue`), and a refused mint must roll the acceptance back rather
    // than leave an approval that authorized nothing.
    return withTransaction(this.store.db, () => {
      const resolved = this.decisions.update(
        decision.id,
        { state: 'accepted', choice: 'approve' },
        decision.version,
      );
      const outcome = this.grants.issue({
        workId: work.id,
        role: input.role,
        stage: input.stage,
        scope: input.scope ?? 'once',
        operation: input.operation,
        targets: input.targets,
        runId: input.runId,
        decisionId: decision.id,
        expiresAt: input.expiresAt,
        limits: input.limits ?? {},
        ...(input.scope === 'run'
          ? {}
          : { toolOperationId: input.toolOperationId, inputHash: input.inputHash }),
      });
      if (!outcome.ok) {
        throw new ProtocolError(outcome.code, outcome.reason, {
          details: { decisionId: decision.id, operation: input.operation },
        });
      }
      const withEffect = this.decisions.update(
        decision.id,
        { effectRefs: [outcome.grant.id] },
        resolved.version,
      );
      this.detachBlocker(work.id, decision.id);
      const resumed = this.moveRun(input.runId, 'running');
      this.store.events.append({
        name: PERMISSION_EVENTS.resolved,
        entityId: resolved.id,
        entityVersion: resolved.version,
        data: {
          workId: work.id,
          runId: input.runId,
          kind: 'permission',
          choice: 'approve',
          operation: input.operation,
          targets: [...input.targets],
          state: resolved.state,
          grantId: outcome.grant.id,
          scope: outcome.grant.scope,
        },
      });
      return {
        decisionId: withEffect.id,
        version: withEffect.version,
        state: 'accepted',
        blockerAttached: false,
        grant: outcome.grant,
        ...(resumed === undefined ? {} : { runStatus: resumed }),
      };
    });
  }

  /**
   * Applies a denial: the Decision is rejected, no Grant is minted, the blocker lifts.
   *
   * A denied environment operation is a *decision*, not a transient failure
   * (`workflow.md` §57): the Run returns to `running` so the model can choose another
   * approach, and the `permission.resolved` event records the refusal — including the
   * operator's optional `reason` (`protocol.md` §4), so the durable audit log says why.
   */
  denyPermission(decisionId: string, runId?: string, reason?: string): PermissionDecisionResult {
    const decision = this.pendingPermission(decisionId);
    const work = this.store.works.find(decision.workId);
    const resolved = this.decisions.update(
      decision.id,
      { state: 'rejected', choice: 'deny' },
      decision.version,
    );
    if (work !== undefined) this.detachBlocker(work.id, decision.id);
    const resumed = runId === undefined ? undefined : this.moveRun(runId, 'running');
    this.store.events.append({
      name: PERMISSION_EVENTS.resolved,
      entityId: resolved.id,
      entityVersion: resolved.version,
      data: {
        workId: decision.workId,
        runId: runId ?? '',
        kind: 'permission',
        choice: 'deny',
        state: resolved.state,
        ...(reason === undefined || reason === '' ? {} : { reason }),
      },
    });
    return {
      decisionId: resolved.id,
      version: resolved.version,
      state: 'rejected',
      blockerAttached: false,
      ...(resumed === undefined ? {} : { runStatus: resumed }),
    };
  }

  /**
   * Moves one Run to a status the transition table allows.
   *
   * Returns the new status, or `undefined` when the Run does not exist or is already
   * there; an illegal edge is refused loudly rather than written, because a Run in a
   * status the table does not support would break every later gate.
   */
  private moveRun(runId: string, status: 'waiting_permission' | 'running'): string | undefined {
    const run = this.store.runs.find(runId);
    if (run === undefined) return undefined;
    if (run.status === status) return undefined;
    if (!canTransitionRun(run.status, status)) {
      throw new ProtocolError(
        'INVALID_STATE',
        `Run ${runId} is ${run.status}; it cannot move to ${status}`,
      );
    }
    const updated = this.store.runs.update(run.id, { status }, run.version);
    this.store.events.append({
      name: 'run.control_changed',
      entityId: updated.id,
      entityVersion: updated.version,
      data: { runId: updated.id, status: updated.status },
    });
    return updated.status;
  }

  private pendingPermission(decisionId: string): Decision {
    const decision = this.decisions.find(decisionId);
    if (decision === undefined) {
      throw new ProtocolError('NOT_FOUND', `Decision ${decisionId} does not exist`);
    }
    if (decision.kind !== 'permission') {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `Decision ${decisionId} is a ${decision.kind} decision; only a permission decision can issue a tool Grant`,
      );
    }
    if (decision.state !== 'pending') {
      throw new ProtocolError(
        'INVALID_STATE',
        `Decision ${decisionId} is already ${decision.state}`,
      );
    }
    return decision;
  }

  // -------------------------------------------------------------------------
  // Revocation (Attempt end, cancel, shutdown)
  // -------------------------------------------------------------------------

  /**
   * Revokes every live Grant of one Run (`reliability.md` §2: the capability and the
   * authority it used end with the Attempt).
   *
   * A completed `once` transaction keeps replaying its recorded result — `revoke` leaves
   * `consumedByOperationId` alone — while every unconsumed Grant refuses afterwards.
   */
  revokeRun(runId: string, reason: string): number {
    let revoked = 0;
    for (const grant of this.grants.currentRunGrants(runId)) {
      const outcome = this.grants.revoke({ grantId: grant.id, at: this.now(), reason });
      if (outcome.ok) revoked += 1;
    }
    return revoked;
  }

  // -------------------------------------------------------------------------
  // Work blockers
  // -------------------------------------------------------------------------

  /** Appends a Decision to `work.blockerIds`; returns whether the row changed. */
  private attachBlocker(workId: string, decisionId: string): boolean {
    const work = this.store.works.find(workId);
    if (work === undefined || work.blockerIds.includes(decisionId)) return false;
    this.store.works.update(
      work.id,
      { blockerIds: [...work.blockerIds, decisionId] },
      work.version,
    );
    return true;
  }

  /** Removes a Decision from `work.blockerIds`; returns whether the row changed. */
  private detachBlocker(workId: string, decisionId: string): boolean {
    const work = this.store.works.find(workId);
    if (work === undefined || !work.blockerIds.includes(decisionId)) return false;
    this.store.works.update(
      work.id,
      { blockerIds: work.blockerIds.filter((id) => id !== decisionId) },
      work.version,
    );
    return true;
  }
}
