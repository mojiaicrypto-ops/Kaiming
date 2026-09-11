/**
 * Artifact storage and versioning (`data.md` §2 `artifact`, §3).
 *
 * An artifact is an immutable blob plus a row: `origin=agent` requires the producing
 * Run, `origin=user` requires the bound Attachment and no Run. Editing an artifact
 * creates a new version (`data.md` §2 "blob不可变；修改新版本"), so the previous row
 * and its bytes stay readable forever.
 */
import {
  type Artifact,
  type ArtifactKind,
  type Attachment,
  type Role,
  type Run,
} from '@agentdev/contracts';
import { StorageError, uuidv7 } from '@agentdev/storage';
import type { BlobStore } from '@agentdev/storage';
import type { ProjectStore } from '@agentdev/storage';
import { ProtocolError } from './errors.js';

export interface ArtifactServiceOptions {
  readonly store: ProjectStore;
  readonly blobs: BlobStore;
  /** Injectable clock, milliseconds. */
  readonly now?: () => number;
}

export interface AgentArtifactInput {
  readonly run: Pick<Run, 'id' | 'workId' | 'role'>;
  readonly kind: ArtifactKind;
  readonly mime: string;
  readonly bytes: Uint8Array;
  /** Roles allowed to read it; empty means every role in the Work may. */
  readonly acl?: readonly Role[];
  readonly sourceRevision?: string;
}

export interface UserArtifactInput {
  readonly workId: string;
  readonly attachment: Pick<
    Attachment,
    'id' | 'mime' | 'bytes' | 'contentHash' | 'relativeBlobPath'
  >;
  readonly acl?: readonly Role[];
}

/** The columns a new artifact row carries; identity/version/validity are derived. */
interface NewArtifactFields {
  readonly workId: string;
  readonly runId?: string;
  readonly origin: 'agent' | 'user';
  readonly attachmentId?: string;
  readonly kind: ArtifactKind;
  readonly mime: string;
  readonly contentHash: string;
  readonly relativeBlobPath: string;
  readonly bytes: number;
  readonly sourceRevision?: string;
  readonly acl: readonly Role[];
}

export class ArtifactService {
  private readonly store: ProjectStore;
  private readonly blobs: BlobStore;
  private readonly now: () => number;

  constructor(options: ArtifactServiceOptions) {
    this.store = options.store;
    this.blobs = options.blobs;
    this.now = options.now ?? (() => Date.now());
  }

  /** Stores one artifact produced by a Run (`origin=agent`). */
  createAgent(input: AgentArtifactInput): Artifact {
    this.validatePayload(input.bytes, input.mime);
    const blob = this.writeBlob(input.bytes);
    return this.insert(
      {
        workId: input.run.workId,
        runId: input.run.id,
        origin: 'agent',
        kind: input.kind,
        mime: input.mime.trim().toLowerCase(),
        contentHash: blob.hash,
        relativeBlobPath: blob.relativePath,
        bytes: blob.bytes,
        ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
        acl: [...(input.acl ?? [])],
      },
      input.run.role,
    );
  }

  /** Stores an artifact backed by a user upload (`origin=user`, no Run). */
  createUser(input: UserArtifactInput): Artifact {
    return this.insert(
      {
        workId: input.workId,
        origin: 'user',
        attachmentId: input.attachment.id,
        kind: 'attachment',
        mime: input.attachment.mime,
        contentHash: input.attachment.contentHash,
        relativeBlobPath: input.attachment.relativeBlobPath,
        bytes: input.attachment.bytes,
        acl: [...(input.acl ?? [])],
      },
      'chief',
    );
  }

  /** Lists one Work's latest artifact rows, newest first. */
  list(workId: string): Artifact[] {
    return this.store.artifacts.list({
      where: 'work_id = ?',
      params: [workId],
      orderBy: 'created_at DESC',
    });
  }

  /** Latest version of each `(kind)` chain for a Work. */
  latestByKind(workId: string, kind: ArtifactKind): Artifact | undefined {
    return this.versionChain(workId, kind).at(-1);
  }

  /**
   * Reads one artifact, optionally a specific version of its chain.
   *
   * `artifactId` locates the chain (its work and kind); `artifactVersion` then picks
   * the row, so a client can ask for "v2 of the explanation I just saw".
   */
  get(artifactId: string, artifactVersion?: number): Artifact {
    const artifact = this.require(artifactId);
    if (artifactVersion === undefined || artifact.artifactVersion === artifactVersion) {
      return artifact;
    }
    const match = this.versionChain(artifact.workId, artifact.kind).find(
      (candidate) => candidate.artifactVersion === artifactVersion,
    );
    if (match === undefined) {
      throw new ProtocolError(
        'NOT_FOUND',
        `artifact ${artifactId} has no version ${artifactVersion}`,
        { details: { artifactId, artifactVersion } },
      );
    }
    return match;
  }

  /** Marks an artifact invalid; the row and its bytes stay readable. */
  invalidate(artifactId: string, reason: string): Artifact {
    const artifact = this.require(artifactId);
    if (artifact.validity === 'invalid') {
      throw new ProtocolError('INVALID_STATE', `artifact ${artifactId} is already invalid`, {
        details: { artifactId, invalidReason: artifact.invalidReason ?? null },
      });
    }
    const updated = this.store.artifacts.update(
      artifact.id,
      { validity: 'invalid', invalidReason: reason },
      artifact.version,
    );
    this.store.events.append({
      name: 'artifact.invalidated',
      entityId: updated.id,
      entityVersion: updated.version,
      data: {
        workId: updated.workId,
        artifactId: updated.id,
        artifactVersion: updated.artifactVersion,
        kind: updated.kind,
        validity: updated.validity,
        invalidReason: reason,
      },
    });
    return updated;
  }

  /** Reads the bytes of an artifact, verifying them against the recorded hash. */
  read(artifact: Pick<Artifact, 'id' | 'relativeBlobPath' | 'contentHash'>): Uint8Array {
    try {
      return this.blobs.readVerified(artifact.relativeBlobPath, artifact.contentHash);
    } catch (error) {
      if (error instanceof StorageError && error.code === 'BLOB_MISSING') {
        throw new ProtocolError('ARTIFACT_MISSING', `artifact ${artifact.id} blob is missing`, {
          details: { artifactId: artifact.id, contentHash: artifact.contentHash },
        });
      }
      if (error instanceof StorageError) {
        throw new ProtocolError('INTERNAL_ERROR', `artifact ${artifact.id} failed verification`, {
          details: { artifactId: artifact.id, storageCode: error.code },
        });
      }
      throw error;
    }
  }

  /** True when `role` may read the artifact; an empty ACL allows every role. */
  isReadable(artifact: Pick<Artifact, 'acl'>, role: Role): boolean {
    return artifact.acl.length === 0 || artifact.acl.includes(role);
  }

  private insert(fields: NewArtifactFields, actorRole: Role): Artifact {
    const before = this.now();
    const version = this.nextVersion(fields.workId, fields.kind);
    const row = this.store.artifacts.insert({
      id: uuidv7(before),
      artifactVersion: version,
      validity: 'valid',
      ...fields,
    } as Partial<Artifact> & Record<string, unknown>);
    this.store.events.append({
      name: 'artifact.created',
      entityId: row.id,
      entityVersion: row.version,
      data: {
        workId: row.workId,
        artifactId: row.id,
        runId: row.runId ?? null,
        origin: row.origin,
        kind: row.kind,
        artifactVersion: row.artifactVersion,
        mime: row.mime,
        bytes: row.bytes,
        contentHash: row.contentHash,
        createdByRole: actorRole,
      },
    });
    return row;
  }

  private nextVersion(workId: string, kind: ArtifactKind): number {
    const chain = this.versionChain(workId, kind);
    return (chain.at(-1)?.artifactVersion ?? 0) + 1;
  }

  private versionChain(workId: string, kind: ArtifactKind): Artifact[] {
    return this.store.artifacts.list({
      where: 'work_id = ? AND kind = ?',
      params: [workId, kind],
      orderBy: 'artifact_version ASC',
    });
  }

  private require(artifactId: string): Artifact {
    const artifact = this.store.artifacts.find(artifactId);
    if (artifact === undefined) {
      throw new ProtocolError('NOT_FOUND', `artifact ${artifactId} does not exist`, {
        details: { artifactId },
      });
    }
    return artifact;
  }

  private validatePayload(bytes: Uint8Array, mime: string): void {
    if (mime.trim().length === 0) {
      throw new ProtocolError('VALIDATION_ERROR', 'artifact mime is required');
    }
    if (bytes.byteLength === 0) {
      throw new ProtocolError('VALIDATION_ERROR', 'artifact content is empty', {
        details: { mime },
      });
    }
  }

  private writeBlob(bytes: Uint8Array): { hash: string; relativePath: string; bytes: number } {
    try {
      return this.blobs.write(bytes);
    } catch (error) {
      // Every storage failure — including a raw filesystem error — must surface as a
      // coded protocol failure (`protocol.md` §7), never as an untyped crash.
      throw new ProtocolError('INTERNAL_ERROR', 'artifact could not be stored', {
        details:
          error instanceof StorageError
            ? { storageCode: error.code }
            : { reason: error instanceof Error ? error.name : 'unknown' },
      });
    }
  }
}
