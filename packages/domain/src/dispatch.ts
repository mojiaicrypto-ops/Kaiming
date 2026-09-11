/**
 * Dispatch and budget admission (`docs/rules/agents.md` §3, `reliability.md` §3).
 *
 * Two invariants live here: every professional Run is a direct child of a Chief
 * Run ("所有子Run为ChiefRun的直接子级"; `agent.dispatch` accepts professional
 * specs only), and a dispatch is allowed only while
 * `used + reserved <= limit` ("used+reserved<=limit才派发").
 */
import type { Budget, DispatchSpec, ProfessionalDispatchSpec } from '@agentdev/contracts';
import { missingSelectionReasons, type ContextSelection } from '@agentdev/contracts';

export type DispatchRejectionCode =
  'MISSING_CONTEXT' | 'VALIDATION_ERROR' | 'NOT_AUTHORIZED' | 'BUDGET_EXCEEDED';

export type DispatchDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: DispatchRejectionCode; readonly message: string };

const reject = (code: DispatchRejectionCode, message: string): DispatchDecision => ({
  ok: false,
  code,
  message,
});

/** Purposes a Chief Run may carry (`data.md` §3, `agents.md` §3). */
const CHIEF_PURPOSES = ['analysis', 'artifact'] as const;

/**
 * Validates what Core may accept from `agent.dispatch`.
 *
 * Chief specs are never accepted from an agent: Core builds them from a user
 * message or a `chief_action_required` event.
 */
export function validateDispatchSpec(spec: DispatchSpec): DispatchDecision {
  const contextProblem = validateContextSelection(spec.contextSelection);
  if (contextProblem !== undefined) return contextProblem;

  if (spec.requiredOutputs.length === 0) {
    return reject('VALIDATION_ERROR', 'requiredOutputs must not be empty');
  }

  if (spec.kind === 'chief') {
    if (!(CHIEF_PURPOSES as readonly string[]).includes(spec.purpose)) {
      return reject('VALIDATION_ERROR', `chief purpose ${spec.purpose} is not analysis/artifact`);
    }
    return { ok: true };
  }

  if (spec.parentRunId.length === 0) {
    return reject('MISSING_CONTEXT', 'a professional dispatch requires parentRunId');
  }
  // The schema already excludes `chief` from a professional spec; the check is
  // repeated at runtime because Core receives decoded JSON, not TypeScript.
  if ((spec.role as string) === 'chief') {
    return reject('VALIDATION_ERROR', 'agent.dispatch cannot target the chief role');
  }
  return { ok: true };
}

/** `ContextSelection` needs a written reason for every selected source. */
export function validateContextSelection(
  selection: ContextSelection,
): DispatchDecision | undefined {
  const missing = missingSelectionReasons(selection);
  if (missing.length > 0) {
    return reject('MISSING_CONTEXT', `sourceRefs without a reason: ${missing.join(', ')}`);
  }
  if (selection.reasonPerSource !== undefined) {
    const keys = Object.keys(selection.reasonPerSource);
    if (keys.length > selection.sourceRefs.length) {
      return reject('VALIDATION_ERROR', 'reasonPerSource has entries for unselected sources');
    }
  }
  return undefined;
}

/** Whether a budget can still fund a dispatch of `requested` tokens. */
export function canAllocateBudget(budget: Budget, requested: number): DispatchDecision {
  if (requested < 0) return reject('VALIDATION_ERROR', 'requested allocation must be >= 0');
  if (budget.tokensUsed + budget.tokensReserved + requested > budget.tokenLimit) {
    return reject(
      'BUDGET_EXCEEDED',
      `used ${budget.tokensUsed} + reserved ${budget.tokensReserved} + ${requested} exceeds ${budget.tokenLimit}`,
    );
  }
  return { ok: true };
}

/** Repair rounds are counted per Task; the limit blocks the next rework. */
export function canStartRepair(budget: Budget): DispatchDecision {
  if (budget.repairUsed >= budget.repairLimit) {
    return reject(
      'BUDGET_EXCEEDED',
      `repair rounds ${budget.repairUsed}/${budget.repairLimit} exhausted`,
    );
  }
  return { ok: true };
}

/** A professional Run's parent must be a Chief Run in the same Work. */
export function isDirectChiefChild(
  child: Pick<ProfessionalDispatchSpec, 'parentRunId' | 'workId'>,
  parent: { readonly id: string; readonly role: string; readonly workId: string },
): boolean {
  return (
    parent.id === child.parentRunId && parent.role === 'chief' && parent.workId === child.workId
  );
}

/**
 * Purpose × role admission (`agents.md` §3: "Core校验role与purpose、Stage、权限").
 *
 * The rule book requires Core to validate the pair but does not tabulate it, so
 * this table is derived from the documented duties in `agents.md` §1 and the
 * stage inputs in §2: a role may carry the purposes that produce its deliverables
 * plus `analysis` (read-only investigation) and, where the duty is explicit,
 * `operation`/`document_check`. `initialize` is the bootstrap investigation every
 * professional role may run before a Project overview exists (§2 first row).
 */
export const PURPOSES_BY_ROLE = {
  product: ['analysis', 'artifact', 'document', 'document_check', 'initialize'],
  planning: ['analysis', 'artifact', 'document', 'initialize'],
  backend: ['analysis', 'implementation', 'operation', 'artifact', 'initialize'],
  frontend: ['analysis', 'implementation', 'operation', 'artifact', 'initialize'],
  review: ['analysis', 'review', 'document_check', 'initialize'],
  test: ['analysis', 'test', 'initialize'],
  settlement: ['analysis', 'settlement', 'document', 'document_check', 'initialize'],
} as const satisfies Record<string, readonly string[]>;

export type ProfessionalRole = keyof typeof PURPOSES_BY_ROLE;

/** Whether `role` is allowed to carry `purpose` on a professional Run. */
export function purposeAllowedForRole(role: string, purpose: string): boolean {
  const allowed = (PURPOSES_BY_ROLE as Record<string, readonly string[]>)[role];
  return allowed !== undefined && allowed.includes(purpose);
}

/** The rejection for an unlisted role/purpose pair, or `undefined`. */
export function validateRolePurpose(role: string, purpose: string): DispatchDecision | undefined {
  if (role === 'chief') {
    return reject('VALIDATION_ERROR', 'a professional dispatch cannot target the chief role');
  }
  if (!purposeAllowedForRole(role, purpose)) {
    return reject('VALIDATION_ERROR', `role ${role} may not carry purpose ${purpose}`);
  }
  return undefined;
}
