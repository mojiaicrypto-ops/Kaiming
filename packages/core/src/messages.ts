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
  type OperationName,
  type Role,
  type Scope,
  type Message,
  type Work,
} from '@agentdev/contracts';
import { uuidv7 } from '@agentdev/storage';
import type { BlobStore } from '@agentdev/storage';
import { routeMessage } from '@agentdev/domain';
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
  /** Explicit authority the message itself grants (`workflow.md` §1, AC-005). */
  readonly authorization?: { readonly scope: Scope; readonly operations: readonly OperationName[] };
  /** Explicit work items when one message carries several intents (AC-006). */
  readonly workItems?: readonly {
    readonly intent: 'assist' | 'artifact' | 'document' | 'delivery';
    readonly goal: string;
  }[];
}

export interface MessageSendResult {
  readonly messageId: string;
  readonly workId: string;
  readonly workIds: readonly string[];
  readonly authorizationId: string | null;
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
  /** Roles allowed to read the uploaded artifacts; empty means every role. */
  readonly acl?: readonly Role[];
  /** Explicit authority the message itself grants (`workflow.md` §1, AC-005). */
  readonly authorization?: { readonly scope: Scope; readonly operations: readonly OperationName[] };
  /** Explicit work items when one message carries several intents (AC-006). */
  readonly workItems?: readonly {
    readonly intent: 'assist' | 'artifact' | 'document' | 'delivery';
    readonly goal: string;
  }[];
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

  // One message may carry several intents: with explicit work items Core creates one
  // Work per item, all bound to the same source message, so an explanation can be
  // delivered while the fix continues (AC-006). Which intents a message has is the
  // Chief's assessment; this is the mechanism it drives.
  const routing = routeMessage(body);
  const allowedIntents = ['assist', 'artifact', 'document', 'delivery'] as const;
  for (const item of input.workItems ?? []) {
    if (
      item === null ||
      typeof item !== 'object' ||
      !allowedIntents.includes(item.intent) ||
      typeof item.goal !== 'string' ||
      item.goal.trim().length === 0
    ) {
      throw new ProtocolError(
        'VALIDATION_ERROR',
        'workItems entries must name an intent and a goal',
        {
          details: { item: JSON.stringify(item) },
        },
      );
    }
  }
  const explicitItems: readonly {
    readonly intent: 'assist' | 'artifact' | 'document' | 'delivery';
    readonly goal: string;
  }[] = input.workItems ?? routing.items;
  // Client-supplied items are matched to routing scopes by position first, so two
  // items of the same intent keep independent scopes (W3R4-01).
  const scopeFor = (item: { readonly intent: string }, index: number): Scope | undefined =>
    input.workItems === undefined
      ? routing.items[index]?.scope
      : routing.items.filter((candidate) => candidate.intent === item.intent)[
          input.workItems.filter(
            (candidate, position) => position < index && candidate.intent === item.intent,
          ).length
        ]?.scope;
  const works: Work[] = [];
  if (input.targetWorkId !== undefined) {
    works.push(requireWork(context, input.targetWorkId, conversation.id));
  } else {
    for (const [index, item] of explicitItems.entries()) {
      const scope = scopeFor(item, index);
      works.push(
        createAssistWork(context, {
          messageId,
          body: item.goal,
          now: before,
          intent: item.intent,
          ...(scope === undefined ? {} : { scope }),
        }),
      );
    }
  }
  const work = works[0];
  if (work === undefined) {
    throw new ProtocolError('VALIDATION_ERROR', 'a message needs at least one work item');
  }
  // An explicit message grants its own authority (`workflow.md` §1): the Core records
  // the Authorization and binds it to the Work, so a delivery assessment has a real
  // `authorizationRef` to point at (AC-005).
  let authorizationId: string | null = null;
  // A follow-up into an existing Work never rewrites that Work's authority facts
  // (W3R4 review): no level change and no new authorization.
  const modifyingWork =
    input.targetWorkId === undefined
      ? works.find((entry) => entry.scope.writePaths.length > 0)
      : undefined;
  const granted =
    input.targetWorkId !== undefined
      ? undefined
      : (input.authorization ?? grantedByMessage(body, routing));
  if (granted !== undefined) {
    // A caller-provided authority may never exceed the scope the message itself
    // named; otherwise the Core would hand out write/environment authority nobody
    // asked for (W3R3 review).
    assertGrantWithinMessage(granted, routing);
  }
  if (granted !== undefined && modifyingWork !== undefined) {
    const authorized = modifyingWork;
    const row = context.store.authorizations.insert({
      sourceRef: { kind: 'message', id: messageId, version: '1' },
      workId: authorized.id,
      goal: body.slice(0, 2_000),
      scope: granted.scope,
      operations: [...granted.operations],
      acceptedAt: new Date(before).toISOString(),
    });
    // `workflow.md` §2.4 keeps L1 for presentation-only changes; a scope that
    // declares operations is L2, which is also what the Core's routing floor
    // enforces, so the recorded level and the gate agree (W3R4-D).
    const level = routing.items.some(
      (item) => item.intent === 'delivery' && item.scope.operations.length > 0,
    )
      ? ('L2' as const)
      : ('L1' as const);
    const updated = context.store.works.update(
      authorized.id,
      { authorizationRef: row.id, level },
      authorized.version,
    );
    const index = works.findIndex((entry) => entry.id === authorized.id);
    if (index >= 0) works[index] = updated;
    authorizationId = row.id;
    // The Assessment records who routed the message and why (`workflow.md` §1): the
    // user message is the scope authorization, so no second confirmation is required
    // inside that scope (AC-005).
    // The `assessment` row holds the routing facts (its `data.md` §2 definition has no
    // goal/scope columns, DC-60); the goal lives on the Work and the scope on the
    // Authorization this message granted.
    context.store.assessments.insert({
      workId: updated.id,
      intent: updated.intent,
      level,
      semanticImpact: false,
      riskFlags: [],
      uncertainties: [],
      authorizationRef: row.id,
      policyRevision: 1,
      reason: routing.reason,
    });
  }

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
      context.artifacts.createUser({
        workId: work.id,
        attachment,
        ...(input.acl === undefined ? {} : { acl: input.acl }),
      }).id,
    );
  }

  return {
    messageId: message.id,
    workId: work.id,
    workIds: works.map((entry) => entry.id),
    authorizationId,
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
            ...(context.params.authorization === undefined
              ? {}
              : { authorization: context.params.authorization }),
            ...(context.params.workItems === undefined
              ? {}
              : { workItems: context.params.workItems }),
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
            workIds: [...result.workIds],
            authorizationId: result.authorizationId,
            attachmentIds: [...result.attachmentIds],
            artifactIds: [...result.artifactIds],
          },
        },
      ],
      response: (_context, result): JsonObject => ({
        messageId: result.messageId,
        workId: result.workId,
        workIds: [...result.workIds],
        authorizationId: result.authorizationId,
        state: result.state,
        version: result.version,
      }),
    },
  ];
}

/**
 * The authority an explicit message grants (`workflow.md` §1, AC-005).
 *
 * A named modification target is the user's own authorization; a pure question grants
 * nothing.
 */
function grantedByMessage(
  body: string,
  routing: ReturnType<typeof routeMessage>,
): { readonly scope: Scope; readonly operations: readonly OperationName[] } | undefined {
  if (!routing.explicitAuthorization) return undefined;
  const writes = routing.items.flatMap((item) => item.writePaths);
  if (writes.length === 0) return undefined;
  return {
    scope: {
      readPaths: [...new Set(writes)],
      writePaths: writes,
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    operations: ['read', 'edit'],
  };
}

/** Rejects authority that goes beyond the paths the message itself named. */
function assertGrantWithinMessage(
  granted: { readonly scope: Scope; readonly operations: readonly OperationName[] },
  routing: ReturnType<typeof routeMessage>,
): void {
  const named = new Set(routing.items.flatMap((item) => item.writePaths));
  const outside = granted.scope.writePaths.filter((path) => !named.has(path));
  const environment = granted.scope.operations.some((operation) =>
    ['bash', 'network', 'secret', 'push', 'deploy', 'delete_data'].includes(operation),
  );
  if (outside.length > 0 || environment || granted.scope.networkTargets.length > 0) {
    throw new ProtocolError(
      'NOT_AUTHORIZED',
      'the supplied authorization exceeds what the message named',
      {
        details: {
          outsideWritePaths: outside,
          operations: [...granted.operations],
        },
      },
    );
  }
}

/** Creates the assist Work a new message is the scope authorization for. */
function createAssistWork(
  context: {
    readonly projectId: string;
    readonly store: OperationContext['store'];
  },
  input: {
    readonly messageId: string;
    readonly body: string;
    readonly now: number;
    readonly intent: 'assist' | 'artifact' | 'document' | 'delivery';
    readonly scope?: Scope;
  },
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
    // The intent comes from the Chief's assessment (or the explicit work item); the
    // direct-collaboration route never needs a Requirement.
    intent: input.intent,
    purpose: input.body.slice(0, 200),
    level: 'none',
    goal: input.body.slice(0, 2_000),
    scope: input.scope ?? { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
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
