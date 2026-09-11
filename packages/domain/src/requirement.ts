/**
 * Requirement projection rules (`docs/product/requirements.md` §4/§6).
 *
 * The local row and the Git record carry different version numbers on purpose:
 * "本机行version独立用于协议expectedVersion并随本机字段变化递增" while
 * `recordVersion` is the cross-server fact. Conflict classification therefore
 * compares `recordVersion` + `recordHash`, never the local version.
 */
import type { RequirementMetadata, RequirementState } from '@agentdev/contracts';

export interface RequirementIdentity {
  readonly recordVersion: number;
  readonly recordHash: string;
}

export type ImportVerdict =
  /** No local projection: create it. */
  | 'new'
  /** Same id/version/hash: nothing changed. */
  | 'unchanged'
  /** Same id, higher recordVersion: refresh the projection. */
  | 'update'
  /** Same recordVersion with different content: REQUIREMENT_CONFLICT. */
  | 'conflict';

/**
 * Classifies one Git record against the local projection.
 *
 * A missing local row is `new`; identical identity is `unchanged`; a higher
 * version is an `update`; and the same version with a different hash is a
 * conflict that must not overwrite anything.
 */
export function classifyImport(
  local: RequirementIdentity | undefined,
  incoming: RequirementIdentity,
): ImportVerdict {
  if (local === undefined) return 'new';
  if (local.recordVersion === incoming.recordVersion) {
    return local.recordHash === incoming.recordHash ? 'unchanged' : 'conflict';
  }
  return incoming.recordVersion > local.recordVersion ? 'update' : 'conflict';
}

/** Records in conflict block writes for that record only (`protocol.md` §8). */
export function writeAllowed(state: RequirementState, conflicted: boolean): boolean {
  if (conflicted) return false;
  // Archived and cancelled records are terminal for content edits.
  return state !== 'archived' && state !== 'cancelled';
}

/** Starting execution needs a Git-persisted `active` record and a local Work. */
export function canStartRequirement(
  metadata: Pick<RequirementMetadata, 'lifecycle'>,
  options: { readonly recordCommitted: boolean; readonly workId?: string },
): boolean {
  if (metadata.lifecycle !== 'active') return false;
  if (!options.recordCommitted) return false;
  return options.workId !== undefined;
}

/** `needs_replan` records have no local Work until a user continues them. */
export function executionAvailabilityFor(
  lifecycle: RequirementState,
  workId: string | undefined,
): 'local' | 'needs_replan' {
  if (lifecycle === 'active' && workId === undefined) return 'needs_replan';
  return 'local';
}

/** The six mandatory second-level headings of `content.md` (`requirements.md` §6). */
export const REQUIRED_CONTENT_SECTIONS = [
  '目标与背景',
  '范围与行为',
  '验收说明',
  '已确认决定',
  '未决问题',
  '完成摘要',
] as const;

/**
 * Checks the structural part of the body contract: each required section heading
 * appears exactly once and the body is not empty. Markdown is never parsed to
 * recover state ("不解析自然语言来恢复状态").
 */
export function validateContentSections(markdown: string): string[] {
  const problems: string[] = [];
  if (markdown.trim() === '') problems.push('content.md must not be empty');
  for (const section of REQUIRED_CONTENT_SECTIONS) {
    const matches = markdown.match(new RegExp(`^## ${section}\\s*$`, 'gm')) ?? [];
    if (matches.length === 0) problems.push(`missing section: ${section}`);
    if (matches.length > 1) problems.push(`duplicate section: ${section}`);
  }
  return problems;
}
