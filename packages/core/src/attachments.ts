/**
 * Staged attachments and their atomic binding to a message (`protocol.md` §5).
 *
 * An attachment is uploaded before any Work exists, so it starts `staged` with a
 * 24 h TTL; `conversation.message.send` binds it in the same transaction that
 * creates the message and the Work. A bound attachment can never be rebound
 * (`ATTACHMENT_ALREADY_BOUND`) — the client must upload a copy instead, which is what
 * keeps one upload from silently backing two messages.
 */
import { ATTACHMENT_LIMITS, type Attachment, type AttachmentState } from '@agentdev/contracts';
import { StorageError, uuidv7 } from '@agentdev/storage';
import type { BlobStore } from '@agentdev/storage';
import type { ProjectStore } from '@agentdev/storage';
import { ProtocolError } from './errors.js';

/**
 * Attachment mime allow-list.
 *
 * `product/experience.md` §3: images are PNG/JPEG/WebP, documents are plain text,
 * Markdown, HTML or PDF. Anything else is refused by the client *and* the server, so
 * the server side is the authority here.
 */
export const ATTACHMENT_MIME_ALLOWLIST = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/html',
  'application/pdf',
] as const;

/**
 * How many staged uploads one owner may keep before binding them.
 *
 * `ATTACHMENT_LIMITS` bounds a single message, not the pending queue; without this a
 * client could park 20 MiB uploads indefinitely (W3 adversarial 5).
 */
export const MAX_STAGED_PER_OWNER = 50;

/**
 * True when the bytes look like the declared mime.
 *
 * `execution.md` §6 requires size, mime *and* file signature checks on upload, so the
 * server does not trust a Content-Type alone.
 */
export function matchesDeclaredType(mime: string, bytes: Uint8Array): boolean {
  const startsWith = (...signature: readonly number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte);
  switch (mime) {
    case 'image/png':
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg':
      return startsWith(0xff, 0xd8, 0xff);
    case 'image/webp':
      return (
        startsWith(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case 'application/pdf':
      return startsWith(0x25, 0x50, 0x44, 0x46);
    default: {
      // Textual types must be valid UTF-8 without NUL bytes; a binary payload hiding
      // behind text/html is refused.
      if (bytes.includes(0)) return false;
      const decoded = Buffer.from(bytes).toString('utf8');
      return !decoded.includes('\uFFFD');
    }
  }
}

export interface AttachmentServiceOptions {
  readonly store: ProjectStore;
  readonly blobs: BlobStore;
  /** Injectable clock, milliseconds. */
  readonly now?: () => number;
}

export interface StageAttachmentInput {
  readonly conversationId: string;
  readonly ownerUserId: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

/** One staged upload plus the identity of the message that will bind it. */
export interface BindAttachmentsInput {
  readonly attachmentIds: readonly string[];
  readonly messageId: string;
  readonly workId: string;
  readonly conversationId: string;
  readonly ownerUserId: string;
}

export class AttachmentService {
  private readonly store: ProjectStore;
  private readonly blobs: BlobStore;
  private readonly now: () => number;

  constructor(options: AttachmentServiceOptions) {
    this.store = options.store;
    this.blobs = options.blobs;
    this.now = options.now ?? (() => Date.now());
  }

  /** Uploads one file as a staged attachment; no Work or Run is required. */
  stage(input: StageAttachmentInput): Attachment {
    // The conversation must exist before any bytes are stored, otherwise the insert
    // fails on its foreign key after the blob is already on disk (W3-05).
    const conversation = this.store.conversations.find(input.conversationId);
    if (conversation === undefined) {
      throw new ProtocolError('NOT_FOUND', `conversation ${input.conversationId} does not exist`, {
        details: { conversationId: input.conversationId },
      });
    }
    if (conversation.archived) {
      throw new ProtocolError('INVALID_STATE', 'the conversation is archived', {
        details: { conversationId: conversation.id },
      });
    }
    const pending = this.list({ conversationId: input.conversationId, state: 'staged' }).filter(
      (attachment) => attachment.ownerUserId === input.ownerUserId,
    );
    if (pending.length >= MAX_STAGED_PER_OWNER) {
      throw new ProtocolError('VALIDATION_ERROR', 'too many pending uploads for this owner', {
        details: { pending: pending.length, max: MAX_STAGED_PER_OWNER },
      });
    }
    const mime = input.mime.trim().toLowerCase();
    if (!(ATTACHMENT_MIME_ALLOWLIST as readonly string[]).includes(mime)) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `attachment mime ${input.mime} is not supported`,
        {
          details: { mime: input.mime, allowlist: [...ATTACHMENT_MIME_ALLOWLIST] },
        },
      );
    }
    if (input.bytes.byteLength === 0) {
      throw new ProtocolError('VALIDATION_ERROR', 'attachment is empty', {
        details: { mime },
      });
    }
    if (!matchesDeclaredType(mime, input.bytes)) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        `attachment content does not match its declared type ${mime}`,
        { details: { mime } },
      );
    }
    if (input.bytes.byteLength > ATTACHMENT_LIMITS.maxBytesEach) {
      throw new ProtocolError('VALIDATION_ERROR', 'attachment exceeds the per-file size limit', {
        details: {
          bytes: input.bytes.byteLength,
          maxBytesEach: ATTACHMENT_LIMITS.maxBytesEach,
        },
      });
    }
    const before = this.now();
    const blob = this.writeBlob(input.bytes);
    return this.store.attachments.insert({
      id: uuidv7(before),
      conversationId: input.conversationId,
      ownerUserId: input.ownerUserId,
      mime,
      state: 'staged',
      expiresAt: new Date(before + ATTACHMENT_LIMITS.stagedTtlHours * 60 * 60 * 1000).toISOString(),
      contentHash: blob.hash,
      relativeBlobPath: blob.relativePath,
      bytes: blob.bytes,
    });
  }

  /**
   * Binds staged attachments to a message and its new Work.
   *
   * The caller runs this inside the message-send transaction, so a failure leaves
   * every attachment `staged` and the client can retry with the same uploads.
   */
  bind(input: BindAttachmentsInput): Attachment[] {
    const before = this.now();
    if (input.attachmentIds.length > ATTACHMENT_LIMITS.maxPerMessage) {
      throw new ProtocolError('VALIDATION_ERROR', 'too many attachments for one message', {
        details: {
          count: input.attachmentIds.length,
          maxPerMessage: ATTACHMENT_LIMITS.maxPerMessage,
        },
      });
    }
    const unique = new Set(input.attachmentIds);
    if (unique.size !== input.attachmentIds.length) {
      throw new ProtocolError('VALIDATION_ERROR', 'the same attachment was listed twice', {
        details: { attachmentIds: [...input.attachmentIds] },
      });
    }
    const attachments: Attachment[] = [];
    let totalBytes = 0;
    for (const id of input.attachmentIds) {
      const attachment = this.store.attachments.find(id);
      if (attachment === undefined) {
        throw new ProtocolError('NOT_FOUND', `attachment ${id} does not exist`, {
          details: { attachmentId: id },
        });
      }
      if (
        attachment.conversationId !== input.conversationId ||
        attachment.ownerUserId !== input.ownerUserId
      ) {
        // Never reveal another user's or conversation's upload.
        throw new ProtocolError('NOT_AUTHORIZED', `attachment ${id} belongs to another owner`, {
          details: { attachmentId: id },
        });
      }
      if (attachment.state === 'bound') {
        throw new ProtocolError('ATTACHMENT_ALREADY_BOUND', `attachment ${id} is already bound`, {
          details: { attachmentId: id, boundMessageId: attachment.boundMessageId ?? null },
        });
      }
      if (attachment.state === 'expired' || Date.parse(attachment.expiresAt) <= before) {
        throw new ProtocolError('INVALID_STATE', `attachment ${id} has expired`, {
          details: { attachmentId: id, expiresAt: attachment.expiresAt },
        });
      }
      totalBytes += attachment.bytes;
      attachments.push(attachment);
    }
    if (totalBytes > ATTACHMENT_LIMITS.maxBytesTotal) {
      throw new ProtocolError('VALIDATION_ERROR', 'attachments exceed the per-message size limit', {
        details: { bytes: totalBytes, maxBytesTotal: ATTACHMENT_LIMITS.maxBytesTotal },
      });
    }
    return attachments.map((attachment) =>
      this.store.attachments.update(
        attachment.id,
        {
          state: 'bound' satisfies AttachmentState,
          boundMessageId: input.messageId,
          workId: input.workId,
        },
        attachment.version,
      ),
    );
  }

  /** Deletes one of the caller's own staged uploads; a bound one is INVALID_STATE. */
  remove(attachmentId: string, ownerUserId: string): Attachment {
    const attachment = this.require(attachmentId);
    if (attachment.ownerUserId !== ownerUserId) {
      throw new ProtocolError(
        'NOT_AUTHORIZED',
        `attachment ${attachmentId} belongs to another user`,
        {
          details: { attachmentId },
        },
      );
    }
    if (attachment.state !== 'staged') {
      throw new ProtocolError(
        'INVALID_STATE',
        `attachment ${attachmentId} is ${attachment.state} and cannot be deleted`,
        { details: { attachmentId, state: attachment.state } },
      );
    }
    return this.store.attachments.update(
      attachment.id,
      { state: 'expired' satisfies AttachmentState },
      attachment.version,
    );
  }

  /**
   * Expires staged uploads past their TTL.
   *
   * The blob is left for the offline GC (`data.md` §4): deleting it here could race a
   * bind that is already in flight with a loaded row.
   */
  expireStale(): readonly string[] {
    const before = this.now();
    const expired: string[] = [];
    for (const attachment of this.store.attachments.list({
      where: 'state = ?',
      params: ['staged'],
    })) {
      if (Date.parse(attachment.expiresAt) > before) continue;
      this.store.attachments.update(
        attachment.id,
        { state: 'expired' satisfies AttachmentState },
        attachment.version,
      );
      expired.push(attachment.id);
    }
    return expired;
  }

  list(input: {
    readonly conversationId?: string;
    readonly state?: AttachmentState;
  }): Attachment[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.conversationId !== undefined) {
      conditions.push('conversation_id = ?');
      params.push(input.conversationId);
    }
    if (input.state !== undefined) {
      conditions.push('state = ?');
      params.push(input.state);
    }
    return this.store.attachments.list({
      ...(conditions.length === 0 ? {} : { where: conditions.join(' AND ') }),
      params,
      orderBy: 'created_at ASC',
    });
  }

  /** Reads the bytes of a bound or staged attachment, verifying the stored hash. */
  read(attachmentId: string): { attachment: Attachment; bytes: Uint8Array } {
    const attachment = this.require(attachmentId);
    try {
      return {
        attachment,
        bytes: this.blobs.readVerified(attachment.relativeBlobPath, attachment.contentHash),
      };
    } catch (error) {
      if (error instanceof StorageError && error.code === 'BLOB_MISSING') {
        throw new ProtocolError('ARTIFACT_MISSING', `attachment ${attachmentId} blob is missing`, {
          details: { attachmentId, contentHash: attachment.contentHash },
        });
      }
      if (error instanceof StorageError) {
        throw new ProtocolError(
          'INTERNAL_ERROR',
          `attachment ${attachmentId} failed verification`,
          { details: { attachmentId, storageCode: error.code } },
        );
      }
      throw error;
    }
  }

  private require(attachmentId: string): Attachment {
    const attachment = this.store.attachments.find(attachmentId);
    if (attachment === undefined) {
      throw new ProtocolError('NOT_FOUND', `attachment ${attachmentId} does not exist`, {
        details: { attachmentId },
      });
    }
    return attachment;
  }

  private writeBlob(bytes: Uint8Array): { hash: string; relativePath: string; bytes: number } {
    try {
      return this.blobs.write(bytes);
    } catch (error) {
      // A blob-layer failure must not surface as an untyped crash: `protocol.md` §7
      // gives every failure a code the client can act on.
      throw new ProtocolError('INTERNAL_ERROR', 'attachment could not be stored', {
        details:
          error instanceof StorageError
            ? { storageCode: error.code }
            : { reason: error instanceof Error ? error.name : 'unknown' },
      });
    }
  }
}
