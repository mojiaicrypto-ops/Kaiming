/**
 * The Requirement projection: one Git record ↔ one local row.
 *
 * `requirements.md` §4 keeps the two version numbers apart — the local row
 * `version` drives `expectedVersion`, while `recordVersion` is the cross-server
 * fact — and `data.md` §2 fixes the import rules: only the local `project_id` is
 * bound, the portable id/version are preserved, and a directory-format problem is a
 * `REQUIREMENT_CONFLICT` rather than a silent overwrite.
 */
import type { PortableRequirement, Requirement, RequirementMetadata } from '@agentdev/contracts';
import { portableRequirementSchema } from '@agentdev/contracts';
import {
  requirementRecordHash,
  sha256,
  type EntityRepository,
  type ProjectStore,
} from '@agentdev/storage';
import { canonicalJson } from './dispatcher.js';
import {
  classifyImport,
  executionAvailabilityFor,
  type ImportVerdict,
  type RequirementIdentity,
} from '@agentdev/domain';

/** Directory layout is fixed by `requirements.md` §2. */
export const REQUIREMENT_RECORD_PATH = (id: string): string =>
  `requirements/${id}/requirement.json`;

export interface ImportRequirementInput {
  /** The parsed `requirement.json` plus `content.md`, or the raw record. */
  readonly record: unknown;
  /** Git path/revision of the record; `hash` is filled with the record hash. */
  readonly portableRef?: { readonly path?: string; readonly revision?: string };
  /** Local execution binding, present only when the Project already has a Work. */
  readonly workId?: string;
  /** Set when the record was verified as committed to Git. */
  readonly recordCommitted?: boolean;
}

export interface RequirementConflict {
  readonly requirementId: string;
  readonly localRecordVersion: number;
  readonly incomingRecordVersion: number;
  readonly localRecordHash: string;
  readonly incomingRecordHash: string;
  readonly reason: string;
}

export type ImportRequirementOutcome =
  | {
      readonly verdict: Exclude<ImportVerdict, 'conflict'>;
      readonly requirementId: string;
      readonly recordVersion: number;
      readonly recordHash: string;
      readonly row?: Requirement;
    }
  | { readonly verdict: 'conflict'; readonly conflict: RequirementConflict };

/** Hashes a metadata object: everything except the separately hashed body. */
export function metadataHashOf(metadata: RequirementMetadata): string {
  return sha256(canonicalJson(metadata));
}

/** The record hash: metadata and body hashes combined (`requirements.md` §4). */
export function recordHashOf(record: PortableRequirement): string {
  const { contentMarkdown, ...metadata } = record;
  void contentMarkdown;
  return requirementRecordHash(metadataHashOf(metadata), record.contentHash);
}

/**
 * Applies Git records to local rows.
 *
 * Every write happens inside one transaction, so a projection refresh can never be
 * half-applied; a conflict writes an event only, leaving the row untouched.
 */
export class RequirementProjection {
  private readonly rows: EntityRepository<Requirement>;
  private readonly store: ProjectStore;

  constructor(options: { store: ProjectStore }) {
    this.store = options.store;
    this.rows = options.store.requirements;
  }

  import(input: ImportRequirementInput): ImportRequirementOutcome {
    const parsed = portableRequirementSchema.safeParse(input.record);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new RequirementRecordError('VALIDATION_ERROR', `invalid requirement record: ${issues}`);
    }
    const record = parsed.data;
    const recordHash = recordHashOf(record);
    const local = this.rows.find(record.id);
    const incomingIdentity: RequirementIdentity = { recordVersion: record.version, recordHash };
    const localIdentity: RequirementIdentity | undefined =
      local === undefined
        ? undefined
        : { recordVersion: local.recordVersion, recordHash: local.portableRef.hash };
    const verdict = classifyImport(localIdentity, incomingIdentity);

    if (verdict === 'conflict') {
      const conflict: RequirementConflict = {
        requirementId: record.id,
        localRecordVersion: local?.recordVersion ?? 0,
        incomingRecordVersion: record.version,
        localRecordHash: local?.portableRef.hash ?? '',
        incomingRecordHash: recordHash,
        reason:
          localIdentity !== undefined && localIdentity.recordVersion === record.version
            ? 'same recordVersion with different content'
            : 'incoming recordVersion is older than the local projection',
      };
      this.store.events.append({
        name: 'requirement.save_failed',
        entityId: record.id,
        entityVersion: local?.version ?? 0,
        data: {
          reason: 'REQUIREMENT_CONFLICT',
          recordVersion: record.version,
          localRecordVersion: conflict.localRecordVersion,
          incomingRecordHash: recordHash,
        },
      });
      return { verdict: 'conflict', conflict };
    }

    if (verdict === 'unchanged' && local !== undefined) {
      return {
        verdict: 'unchanged',
        requirementId: record.id,
        recordVersion: record.version,
        recordHash,
        row: local,
      };
    }

    const fields = this.fieldsFor(record, recordHash, input);
    if (verdict === 'new') {
      const row = this.rows.insert({ id: record.id, ...fields });
      this.store.events.append({
        name: 'requirement.imported',
        entityId: row.id,
        entityVersion: row.version,
        data: { recordVersion: record.version, recordHash, verdict: 'new' },
      });
      return {
        verdict: 'new',
        requirementId: row.id,
        recordVersion: record.version,
        recordHash,
        row,
      };
    }

    const current = local as Requirement;
    const row = this.rows.update(current.id, fields, current.version);
    this.store.events.append({
      name: 'requirement.imported',
      entityId: row.id,
      entityVersion: row.version,
      data: { recordVersion: record.version, recordHash, verdict: 'update' },
    });
    return {
      verdict: 'update',
      requirementId: row.id,
      recordVersion: record.version,
      recordHash,
      row,
    };
  }

  /** Local projection lookup, used by the read model. */
  find(requirementId: string): Requirement | undefined {
    return this.rows.find(requirementId);
  }

  list(): Requirement[] {
    return this.rows.list({ orderBy: 'created_at DESC' });
  }

  private fieldsFor(
    record: PortableRequirement,
    recordHash: string,
    input: ImportRequirementInput,
  ): Record<string, unknown> {
    const workId = input.workId;
    return {
      ...(workId === undefined ? {} : { workId }),
      title: record.title,
      goal: record.goal,
      lifecycle: record.lifecycle,
      ...(record.previousLifecycle === undefined
        ? {}
        : { previousLifecycle: record.previousLifecycle }),
      // The record itself is a Git fact, and an imported record alone carries no
      // local evidence yet.
      sourceRef: { kind: 'git', id: record.id, version: String(record.version) },
      recordVersion: record.version,
      portableRef: {
        // `portableRef.hash` is the record hash: it is what conflict detection
        // compares, and the row has no second hash column (`data.md` §2).
        path: input.portableRef?.path ?? REQUIREMENT_RECORD_PATH(record.id),
        revision: input.portableRef?.revision ?? 'working-tree',
        hash: recordHash,
      },
      executionAvailability: executionAvailabilityFor(record.lifecycle, workId),
      evidenceAvailability: 'summary_only',
    };
  }
}

/** Thrown before any write when the record itself is malformed. */
export class RequirementRecordError extends Error {
  readonly code: 'VALIDATION_ERROR';

  constructor(code: 'VALIDATION_ERROR', message: string) {
    super(message);
    this.name = 'RequirementRecordError';
    this.code = code;
  }
}
