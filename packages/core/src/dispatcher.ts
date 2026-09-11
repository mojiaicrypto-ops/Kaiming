/**
 * The command dispatcher: envelope validation, authorization, idempotency and the
 * atomic write boundary.
 *
 * `reliability.md` §1 orders one write as
 * "校验身份/版本/幂等→更新领域行→写command response→写event→写outbox→COMMIT→应答".
 * Every one of those steps happens inside a single mailbox command, so a crash can
 * never leave a recorded response without its effects — or the reverse.
 */
import type { JsonObject } from '@agentdev/contracts';
import type { ContractSchema, EntityRepository, ProjectStore } from '@agentdev/storage';
import { StorageError, sha256, withTransaction } from '@agentdev/storage';
import {
  ProtocolError,
  errorResponse,
  okResponse,
  type RequestEnvelope,
  type ResponseEnvelope,
} from './errors.js';
import type { MailboxDiagnostic, ProjectMailbox } from './mailbox.js';

export interface OperationContext<P = JsonObject> {
  readonly projectId: string;
  readonly subject: string;
  readonly params: P;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly store: ProjectStore;
  readonly mailbox: ProjectMailbox;
}

export interface NewEvent {
  readonly name: string;
  readonly entityId: string;
  readonly entityVersion: number;
  readonly data?: JsonObject;
}

export interface NewOutboxEntry {
  readonly operationId: string;
  readonly kind: string;
  readonly payload?: JsonObject;
}

export interface OperationDefinition<P = JsonObject, R = unknown> {
  readonly method: string;
  readonly kind: 'read' | 'write';
  /**
   * `project` methods must carry `projectId`; only `connection.*`-style global
   * methods may omit it (`protocol.md` §1). Defaults to `project`.
   */
  readonly scope?: 'project' | 'global';
  /** Validated before authorization, so a handler never sees a bad shape. */
  readonly params?: ContractSchema<P>;
  /** Returns a `ProtocolError` to refuse, or nothing to allow. */
  readonly authorize?: (
    context: Pick<OperationContext<P>, 'projectId' | 'subject' | 'params'>,
  ) => void;
  readonly handle: (context: OperationContext<P>) => R;
  /** Events written in the same transaction as the domain rows. */
  readonly events?: (context: OperationContext<P>, result: R) => readonly NewEvent[];
  /** Side effects delivered at least once after the commit. */
  readonly outbox?: (context: OperationContext<P>, result: R) => readonly NewOutboxEntry[];
  /** `applied` for a synchronous change, `accepted` for a queued long operation. */
  readonly resultKind?: 'applied' | 'accepted';
  /** Builds the response body; defaults to `{status, entityId, version}`. */
  readonly response?: (context: OperationContext<P>, result: R) => JsonObject;
}

export interface CommandDispatcherOptions {
  readonly projectId: string;
  readonly store: ProjectStore;
  readonly mailbox: ProjectMailbox;
  /** Authenticated caller identity, e.g. `user:<id>` or `cli:<installation>`. */
  readonly subject: string;
  /** Project-wide authorization, e.g. trust state and Grant evaluation. */
  readonly authorize?: (method: string, subject: string) => void;
  readonly now?: () => string;
  readonly onDiagnostic?: (diagnostic: MailboxDiagnostic) => void;
}

interface WriteOutcome {
  readonly replayed: boolean;
  readonly response: unknown;
}

/** Deterministic JSON so the same params always hash to the same payload. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

/** SHA256 over method + params: the "same payload" test of AC-055. */
export function payloadHashOf(method: string, params: unknown): string {
  return sha256(canonicalJson({ method, params: params ?? {} }));
}

/**
 * Dispatches protocol requests for one Project.
 *
 * Reads bypass the mailbox — they never mutate business state — while every write
 * is admitted through it, which is what keeps ProjectMailbox serial.
 */
export class CommandDispatcher {
  private readonly operations = new Map<string, OperationDefinition<never, unknown>>();
  private readonly options: CommandDispatcherOptions;

  constructor(options: CommandDispatcherOptions) {
    this.options = options;
  }

  register<P, R>(definition: OperationDefinition<P, R>): this {
    if (this.operations.has(definition.method)) {
      throw new Error(`operation ${definition.method} is already registered`);
    }
    this.operations.set(
      definition.method,
      definition as unknown as OperationDefinition<never, unknown>,
    );
    return this;
  }

  has(method: string): boolean {
    return this.operations.has(method);
  }

  methods(): string[] {
    return [...this.operations.keys()].sort();
  }

  /** Convenience accessor for handlers and tests. */
  get store(): ProjectStore {
    return this.options.store;
  }

  /** Runs one request envelope and always resolves with exactly one response. */
  async dispatch(envelope: RequestEnvelope): Promise<ResponseEnvelope> {
    const id = typeof envelope?.id === 'string' && envelope.id !== '' ? envelope.id : 'unknown';
    try {
      return okResponse(id, await this.execute(envelope));
    } catch (error) {
      return errorResponse(id, this.toProtocolError(error));
    }
  }

  private async execute(envelope: RequestEnvelope): Promise<unknown> {
    if (envelope?.v !== 1) {
      throw new ProtocolError(
        'PROTOCOL_MISMATCH',
        `unsupported protocol version ${String(envelope?.v)}`,
      );
    }
    if (envelope.type !== 'request') {
      throw new ProtocolError('VALIDATION_ERROR', 'type must be "request"');
    }
    if (typeof envelope.id !== 'string' || envelope.id === '') {
      throw new ProtocolError('VALIDATION_ERROR', 'id must be a non-empty string');
    }
    const definition = this.operations.get(envelope.method);
    if (definition === undefined) {
      throw new ProtocolError('NOT_FOUND', `unknown method ${envelope.method}`, {
        details: { method: envelope.method },
      });
    }

    // A Project method never reaches another Project's runtime; a borrowed id is
    // indistinguishable from a missing one, and a Project method must carry one.
    if ((definition.scope ?? 'project') === 'project' && envelope.projectId === undefined) {
      throw new ProtocolError('VALIDATION_ERROR', `${definition.method} requires projectId`);
    }
    if (envelope.projectId !== undefined && envelope.projectId !== this.options.projectId) {
      throw new ProtocolError('NOT_FOUND', `project ${envelope.projectId} is not open here`);
    }

    const rawParams = (envelope.params ?? {}) as Record<string, unknown>;
    let params: JsonObject;
    if (definition.params === undefined) {
      params = rawParams as JsonObject;
    } else {
      const parsed = definition.params.safeParse(rawParams);
      if (!parsed.success) {
        throw new ProtocolError('VALIDATION_ERROR', `${definition.method}: invalid params`, {
          details: { issues: describeIssues(parsed.error) },
        });
      }
      params = parsed.data;
    }

    this.options.authorize?.(definition.method, this.options.subject);
    const contextBase = {
      projectId: this.options.projectId,
      subject: this.options.subject,
      params: params as never,
      store: this.options.store,
      mailbox: this.options.mailbox,
    };
    definition.authorize?.({
      projectId: this.options.projectId,
      subject: this.options.subject,
      params: params as never,
    });

    if (definition.kind === 'read') {
      return definition.handle({ ...contextBase, expectedVersion: 0, idempotencyKey: '' });
    }

    const key = envelope.idempotencyKey;
    if (typeof key !== 'string' || key.length < 1 || key.length > 128) {
      throw new ProtocolError('VALIDATION_ERROR', 'idempotencyKey must be 1–128 characters');
    }
    const expectedVersion = envelope.expectedVersion;
    if (
      typeof expectedVersion !== 'number' ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0
    ) {
      throw new ProtocolError('VALIDATION_ERROR', 'expectedVersion must be an integer >= 0');
    }

    const hash = payloadHashOf(definition.method, params);
    const admission = this.options.mailbox.submitCommand<WriteOutcome>({
      subject: this.options.subject,
      operation: definition.method,
      bytes: Buffer.byteLength(canonicalJson(params), 'utf8'),
      run: () =>
        this.writeAtomically(
          definition,
          {
            ...contextBase,
            expectedVersion,
            idempotencyKey: key,
          },
          hash,
        ),
    });

    if (!admission.accepted) {
      throw new ProtocolError('BUSY', `mailbox ${admission.reason}`, {
        retryable: true,
        details: {
          reason: admission.reason,
          queueItems: admission.queueItems,
          queueBytes: admission.queueBytes,
          limits: { ...admission.limits },
        },
      });
    }

    const outcome = await admission.completion;
    return outcome.response;
  }

  /**
   * One transaction for the whole write: ledger → domain rows → events → outbox.
   *
   * A replay short-circuits before any effect, which is what makes a retry after a
   * lost response safe (AC-055).
   */
  private writeAtomically(
    definition: OperationDefinition<never, unknown>,
    context: OperationContext<never>,
    hash: string,
  ): WriteOutcome {
    try {
      return withTransaction(this.options.store.db, () => {
        const begun = this.options.store.commands.begin({
          subject: context.subject,
          operation: definition.method,
          key: context.idempotencyKey,
          payloadHash: hash,
        });
        if (begun.kind === 'conflict') {
          throw new ProtocolError('IDEMPOTENCY_CONFLICT', begun.reason);
        }
        if (begun.kind === 'replay') {
          return { replayed: true, response: begun.response };
        }

        const result = definition.handle(context);
        if (result instanceof Promise) {
          throw new ProtocolError(
            'INTERNAL_ERROR',
            `${definition.method} must be synchronous inside the mailbox transaction`,
          );
        }

        for (const event of definition.events?.(context, result) ?? []) {
          this.options.store.events.append(event);
        }
        for (const entry of definition.outbox?.(context, result) ?? []) {
          this.options.store.outbox.enqueue(entry);
        }

        const response = this.buildResponse(definition, context, result);
        this.options.store.commands.complete(begun.commandId, response);
        return { replayed: false, response };
      });
    } catch (error) {
      throw this.toProtocolError(error);
    }
  }

  private buildResponse(
    definition: OperationDefinition<never, unknown>,
    context: OperationContext<never>,
    result: unknown,
  ): JsonObject {
    const custom = definition.response?.(context, result);
    if (custom !== undefined) return custom;
    const entity = (result ?? {}) as { id?: unknown; version?: unknown };
    return {
      status: definition.resultKind ?? 'applied',
      ...(typeof entity.id === 'string' ? { entityId: entity.id } : {}),
      ...(typeof entity.version === 'number' ? { version: entity.version } : {}),
    };
  }

  /** Maps storage and protocol failures onto the documented error table. */
  private toProtocolError(error: unknown): ProtocolError {
    if (error instanceof ProtocolError) return error;
    if (error instanceof StorageError) {
      const details = { ...error.details } as JsonObject;
      switch (error.code) {
        case 'VERSION_CONFLICT':
          return new ProtocolError('VERSION_CONFLICT', error.message, {
            details: { currentVersion: error.details['currentVersion'] } as JsonObject,
          });
        case 'NOT_FOUND':
          return new ProtocolError('NOT_FOUND', error.message, { details });
        case 'DUPLICATE_KEY':
          return new ProtocolError('INVALID_STATE', error.message, { details });
        case 'BLOB_MISSING':
          return new ProtocolError('ARTIFACT_MISSING', error.message, { details });
        case 'BUSY':
          return new ProtocolError('BUSY', error.message, { retryable: true, details });
        case 'CONSTRAINT_VIOLATION':
          return new ProtocolError('VALIDATION_ERROR', error.message, { details });
        default:
          return new ProtocolError('INTERNAL_ERROR', error.message, { details });
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    return new ProtocolError('INTERNAL_ERROR', message);
  }
}

function describeIssues(error: unknown): JsonObject[] {
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [{ message: String(error) }];
  return issues.map((issue) => {
    const entry = issue as { path?: unknown; message?: unknown };
    return {
      path: (Array.isArray(entry.path) ? entry.path : []).map((part) => String(part)),
      message: typeof entry.message === 'string' ? entry.message : 'invalid value',
    };
  });
}

/** Repository helper: the row version a write must match, read before mutating. */
export function currentVersionOf<T extends Record<string, unknown>>(
  repository: EntityRepository<T>,
  key: string,
): number | undefined {
  const row = repository.find(key);
  return row === undefined ? undefined : Number(row['version']);
}
