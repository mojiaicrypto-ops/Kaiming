/**
 * `conversation.message.send` — the transactional entry into direct collaboration.
 *
 * `protocol.md` §3/§5: a new message allocates the conversation sequence, creates the
 * Work it is the scope authorization for, binds staged attachments **atomically**, and
 * turns each bound attachment into an `origin=user` artifact. A failure leaves every
 * attachment staged so the client can retry with the same uploads, and a repeated
 * idempotency key returns the original binding instead of duplicating the message.
 */
import {
  LIMITS,
  PROTOCOL_LIMITS,
  type JsonObject,
  type Message,
  type Work,
} from '@agentdev/contracts';
import { uuidv7 } from '@agentdev/storage';
import type { BlobStore } from '@agentdev/storage';
import { userIdFromSubject } from './identity.js';
import type { OperationDefinition, OperationContext } from './dispatcher.js';
import { ProtocolError } from './errors.js';
import type { AttachmentService } from './attachments.js';
import type { ArtifactService } from './artifacts.js';

export interface MessageSendParams {
  readonly conversationId: string;
  readonly body: string;
  readonly attachmentIds: readonly string[];
  readonly targetWorkId?: string;
}

export interface MessageSendResult {
  readonly messageId: string;
  readonly workId: string;
  readonly state: Message['state'];
  readonly version: number;
  readonly attachmentIds: readonly string[];
  readonly artifactIds: readonly string[];
}

export interface MessageOperationsOptions {
  readonly attachments: AttachmentService;
  readonly artifacts: ArtifactService;
  readonly blobs: BlobStore;
  /** Injectable clock, milliseconds. */
  readonly now?: () => number;
}

export interface MessageTransactionInput {
  readonly conversationId: string;
  readonly body: string;
  readonly attachmentIds?: readonly string[];
  readonly targetWorkId?: string;
  /**
   * Ownership id of the uploads being bound, already resolved by the caller.
   *
   * The daemon passes the installation user; the dispatcher operation derives it from
   * the authenticated subject. Keeping it resolved avoids deriving twice.
   */
  readonly ownerUserId: string;
}

/**
 * Sends one message inside the caller's transaction.
 *
 * Exported separately from the dispatcher operation so the HTTP layer and tests can
 * drive exactly the same code path; the dispatcher adds idempotency and events.
 */
export function sendMessage(
  context: {
    readonly projectId: string;
    readonly store: OperationContext['store'];
    readonly attachments: AttachmentService;
    readonly artifacts: ArtifactService;
    readonly blobs: BlobStore;
    readonly now: () => number;
  },
  input: MessageTransactionInput,
): MessageSendResult {
  const before = context.now();
  const body = input.body ?? '';
  if (body.trim().length === 0) {
    throw new ProtocolError('VALIDATION_ERROR', 'a message body is required');
  }
  if (body.length > PROTOCOL_LIMITS.messageBodyMaxChars) {
    throw new ProtocolError('VALIDATION_ERROR', 'the message body is too long', {
      details: { length: body.length, maxChars: PROTOCOL_LIMITS.messageBodyMaxChars },
    });
  }
  const conversation = context.store.conversations.find(input.conversationId);
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

  const messageId = uuidv7(before);
  const owner = input.ownerUserId;
  const sequence = context.store.messages.count('conversation_id = ?', [conversation.id]) + 1;
  // `data.md` §4: the body blob is written first and the immutable `message_body`
  // row references it by hash (W3-04).
  const bodyBlob = context.blobs.write(body);
  if (bodyBlob.hash !== bodyBlob.hash.toLowerCase() || bodyBlob.relativePath.length === 0) {
    throw new ProtocolError('INTERNAL_ERROR', 'the message body could not be stored');
  }
  const bodyRow = context.store.messageBodies.insert({
    id: uuidv7(before),
    ownerKind: 'user',
    ownerUserId: owner,
    mime: 'text/plain',
    contentHash: bodyBlob.hash,
    relativeBlobPath: bodyBlob.relativePath,
    bytes: bodyBlob.bytes,
  } as never);

  const work =
    input.targetWorkId === undefined
      ? createAssistWork(context, { messageId, body, now: before })
      : requireWork(context, input.targetWorkId, conversation.id);

  // Validate and bind every upload before the message row exists, so a bad list
  // cannot leave a half-sent message behind.
  const staged = context.attachments.bind({
    attachmentIds: input.attachmentIds ?? [],
    messageId,
    workId: work.id,
    conversationId: conversation.id,
    ownerUserId: owner,
  });

  const message = context.store.messages.insert({
    id: messageId,
    conversationId: conversation.id,
    seq: sequence,
    sender: 'user',
    bodyRef: bodyRow.id,
    ...(input.targetWorkId === undefined ? {} : { targetWorkId: input.targetWorkId }),
    state: 'received',
    resultRefs: [],
  } as never);

  const artifactIds: string[] = [];
  for (const attachment of staged) {
    artifactIds.push(
      context.artifacts.createUser({ workId: work.id, attachment, acl: ['chief'] }).id,
    );
  }

  return {
    messageId: message.id,
    workId: work.id,
    state: message.state,
    version: message.version,
    attachmentIds: staged.map((attachment) => attachment.id),
    artifactIds,
  };
}

/**
 * The dispatcher operation for `conversation.message.send`.
 *
 * The dispatcher has already authenticated the caller, so the subject is the upload
 * owner; the handler itself only sees validated params.
 */
export function createMessageOperations(
  options: MessageOperationsOptions,
): readonly OperationDefinition<MessageSendParams, MessageSendResult>[] {
  const now = options.now ?? (() => Date.now());
  return [
    {
      method: 'conversation.message.send',
      kind: 'write',
      handle: (context: OperationContext<MessageSendParams>) =>
        sendMessage(
          {
            projectId: context.projectId,
            store: context.store,
            attachments: options.attachments,
            artifacts: options.artifacts,
            blobs: options.blobs,
            now,
          },
          {
            conversationId: context.params.conversationId,
            body: context.params.body,
            ...(context.params.attachmentIds === undefined
              ? {}
              : { attachmentIds: context.params.attachmentIds }),
            ...(context.params.targetWorkId === undefined
              ? {}
              : { targetWorkId: context.params.targetWorkId }),
            ownerUserId: userIdFromSubject(context.subject),
          },
        ),
      events: (_context, result) => [
        {
          name: 'message.received',
          entityId: result.messageId,
          entityVersion: result.version,
          data: {
            messageId: result.messageId,
            workId: result.workId,
            attachmentIds: [...result.attachmentIds],
            artifactIds: [...result.artifactIds],
          },
        },
      ],
      response: (_context, result): JsonObject => ({
        messageId: result.messageId,
        workId: result.workId,
        state: result.state,
        version: result.version,
      }),
    },
  ];
}

/** Creates the assist Work a new message is the scope authorization for. */
function createAssistWork(
  context: {
    readonly projectId: string;
    readonly store: OperationContext['store'];
  },
  input: { readonly messageId: string; readonly body: string; readonly now: number },
): Work {
  const workId = uuidv7(input.now);
  const budget = context.store.budgets.insert({
    projectId: context.projectId,
    workId,
    tokenLimit: LIMITS.workInputOutputTokens.default,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: LIMITS.workActiveTimeSec.default,
    activeTimeUsed: 0,
    repairLimit: LIMITS.reviewRepairRounds.default,
    repairUsed: 0,
    costKnown: true,
  });
  return context.store.works.insert({
    id: workId,
    projectId: context.projectId,
    // A new message starts on the direct-collaboration route; the Chief's assessment
    // refines intent/level and that route never needs a Requirement.
    intent: 'assist',
    purpose: input.body.slice(0, 200),
    level: 'none',
    goal: input.body.slice(0, 2_000),
    scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
    sourceRef: { kind: 'message', id: input.messageId, version: '1' },
    status: 'queued',
    blockerIds: [],
    budgetId: budget.id,
    policyRevision: 1,
  } as never);
}

function requireWork(
  context: { readonly store: OperationContext['store'] },
  workId: string,
  conversationId: string,
): Work {
  const work = context.store.works.find(workId);
  if (work === undefined) {
    throw new ProtocolError('NOT_FOUND', `Work ${workId} does not exist`, { details: { workId } });
  }
  // A follow-up may only target a Work created from this conversation; otherwise a
  // session could attach its message to another conversation's Work (W3 review).
  if (work.sourceRef.kind === 'message') {
    const source = context.store.messages.find(work.sourceRef.id);
    if (source !== undefined && source.conversationId !== conversationId) {
      throw new ProtocolError('NOT_AUTHORIZED', `Work ${workId} belongs to another conversation`, {
        details: { workId, conversationId },
      });
    }
  }
  return work;
}
