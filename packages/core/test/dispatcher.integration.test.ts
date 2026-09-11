import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectIdFromRoot, type ContractSchema, type ProjectStore } from '@agentdev/storage';
import { ProjectStore as Store } from '@agentdev/storage';
import {
  CommandDispatcher,
  ProjectMailbox,
  canonicalJson,
  payloadHashOf,
  type OperationContext,
  type RequestEnvelope,
} from '../src/index.js';

/**
 * Dispatcher mechanics for AC-055 (idempotent accept, conflicting key) plus the
 * atomic write boundary from `reliability.md` §1: ledger, domain row, events and
 * outbox either all commit or all roll back.
 */
const TIME = '2026-09-11T00:00:00.000Z';
const ROOT = '/tmp/agentdev-dispatch-root';
const SUBJECT = 'user:018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
/** Outbox operationIds are UUIDs, like every other entity id. */
const OUTBOX_OPERATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e99';

let dataDir: string;
let store: ProjectStore;
let mailbox: ProjectMailbox;
let dispatcher: CommandDispatcher;
let projectId: string;

interface BumpParams {
  readonly budgetId: string;
  readonly amount: number;
}

/** A structural contract schema, so core keeps its dependency set. */
function bumpParamsSchema(): ContractSchema<BumpParams> {
  const check = (value: unknown): string | undefined => {
    const params = value as Partial<BumpParams> | null;
    if (params === null || typeof params !== 'object') return 'params must be an object';
    if (typeof params.budgetId !== 'string') return 'budgetId must be a string';
    if (typeof params.amount !== 'number' || params.amount <= 0) {
      return 'amount must be a positive number';
    }
    return undefined;
  };
  return {
    shape: { budgetId: {}, amount: {} },
    parse: (value) => {
      const problem = check(value);
      if (problem !== undefined) throw new Error(problem);
      return value as BumpParams;
    },
    safeParse: (value) => {
      const problem = check(value);
      return problem === undefined
        ? { success: true, data: value as BumpParams }
        : { success: false, error: { issues: [{ path: [], message: problem }] } };
    },
  };
}

function request(overrides: Partial<RequestEnvelope> = {}): RequestEnvelope {
  return {
    v: 1,
    type: 'request',
    id: 'req-1',
    method: 'test.budget.bump',
    projectId,
    params: { budgetId: budgetId, amount: 5 },
    idempotencyKey: 'key-1',
    expectedVersion: 1,
    ...overrides,
  };
}

let budgetId: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'agentdev-dispatch-'));
  store = Store.open({
    dataDir,
    canonicalRoot: ROOT,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  projectId = projectIdFromRoot(ROOT);
  store.projects.insert({
    id: projectId,
    root: ROOT,
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
  });
  const budget = store.budgets.insert({
    projectId,
    workId: WORK_ID,
    tokenLimit: 1000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 600,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  budgetId = budget.id;

  mailbox = new ProjectMailbox();
  dispatcher = new CommandDispatcher({
    projectId,
    store,
    mailbox,
    subject: SUBJECT,
    now: () => TIME,
  });
  dispatcher
    .register<BumpParams, { id: string; version: number }>({
      method: 'test.budget.bump',
      kind: 'write',
      params: bumpParamsSchema(),
      handle: (context: OperationContext<BumpParams>) => {
        const current = context.store.budgets.get(context.params.budgetId);
        return context.store.budgets.update(
          current.id,
          { tokensUsed: current.tokensUsed + context.params.amount },
          context.expectedVersion,
        );
      },
      events: (context, result) => [
        {
          name: 'work.control_changed',
          entityId: result.id,
          entityVersion: result.version,
          data: { tokensUsed: result.version, command: context.idempotencyKey },
        },
      ],
      outbox: () => [{ operationId: OUTBOX_OPERATION_ID, kind: 'integrate', payload: { step: 1 } }],
    })
    .register({
      method: 'test.budget.get',
      kind: 'read',
      handle: (context: OperationContext<Record<string, never>>) =>
        context.store.budgets.find(budgetId) ?? null,
    })
    .register({
      method: 'test.always.fails',
      kind: 'write',
      handle: () => {
        throw new Error('domain failure');
      },
    });
});

afterEach(() => {
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('dispatcher validation', () => {
  it('rejects a malformed envelope with the documented code', async () => {
    expect(await dispatcher.dispatch(request({ method: 'nope' }))).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await dispatcher.dispatch({ ...request(), v: 2 as unknown as 1 })).toMatchObject({
      ok: false,
      error: { code: 'PROTOCOL_MISMATCH' },
    });
    expect(
      await dispatcher.dispatch({ ...request(), params: { budgetId: 7, amount: 1 } }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await dispatcher.dispatch({ ...request(), projectId: 'f'.repeat(32) })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await dispatcher.dispatch({ ...request(), idempotencyKey: '' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(await dispatcher.dispatch({ ...request(), expectedVersion: 1.5 })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('answers a read without an idempotency key', async () => {
    const response = await dispatcher.dispatch({
      v: 1,
      type: 'request',
      id: 'req-read',
      method: 'test.budget.get',
      params: {},
    });
    expect(response).toMatchObject({ ok: true, id: 'req-read' });
    if (response.ok) expect((response.result as { version: number }).version).toBe(1);
  });
});

describe('write path (AC-055)', () => {
  it('applies one write, then replays the same result for the same key', async () => {
    const first = await dispatcher.dispatch(request());
    expect(first).toEqual({
      v: 1,
      type: 'response',
      id: 'req-1',
      ok: true,
      result: { status: 'applied', entityId: budgetId, version: 2 },
    });
    expect(store.budgets.get(budgetId).tokensUsed).toBe(5);
    expect(store.commands.lookup(SUBJECT, 'test.budget.bump', 'key-1')).toMatchObject({
      state: 'completed',
    });
    expect(store.events.latestCursor()).toBe(1);
    expect(store.outbox.countByState()).toEqual({ pending: 1 });

    // The response was lost, so the client retries the identical request.
    const retry = await dispatcher.dispatch(request());
    expect(retry).toEqual(first);
    expect(store.budgets.get(budgetId).tokensUsed).toBe(5);
    expect(store.events.latestCursor()).toBe(1);
    expect(store.outbox.countByState()).toEqual({ pending: 1 });
  });

  it('refuses the same key with a different payload', async () => {
    await dispatcher.dispatch(request());
    const conflict = await dispatcher.dispatch(request({ params: { budgetId, amount: 9 } }));
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: 'IDEMPOTENCY_CONFLICT', retryable: false },
    });
    expect(store.budgets.get(budgetId).tokensUsed).toBe(5);
    expect(payloadHashOf('test.budget.bump', { budgetId, amount: 5 })).toBe(
      payloadHashOf('test.budget.bump', { amount: 5, budgetId }),
    );
  });

  it('reports a version conflict with the current version', async () => {
    await dispatcher.dispatch(request());
    const stale = await dispatcher.dispatch(
      request({ id: 'req-2', idempotencyKey: 'key-2', expectedVersion: 1 }),
    );
    expect(stale).toMatchObject({
      ok: false,
      error: { code: 'VERSION_CONFLICT', details: { currentVersion: 2 } },
    });
    // A conflict is not an accepted command: nothing was recorded.
    expect(store.commands.lookup(SUBJECT, 'test.budget.bump', 'key-2')).toBeUndefined();
    expect(store.events.latestCursor()).toBe(1);
  });

  it('rolls back the ledger, events and outbox when the handler fails', async () => {
    const failed = await dispatcher.dispatch(
      request({ method: 'test.always.fails', params: {}, id: 'req-3', idempotencyKey: 'key-3' }),
    );
    expect(failed).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(store.commands.lookup(SUBJECT, 'test.always.fails', 'key-3')).toBeUndefined();
    expect(store.events.latestCursor()).toBe(0);
    expect(store.outbox.countByState()).toEqual({});

    // With the transaction rolled back, the same key can be retried cleanly.
    const retry = await dispatcher.dispatch(
      request({ method: 'test.always.fails', params: {}, id: 'req-4', idempotencyKey: 'key-3' }),
    );
    expect(retry).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });

  it('answers BUSY without executing when the mailbox queue is full', async () => {
    const busyMailbox = new ProjectMailbox({ limits: { queueItems: 1 } });
    const busyDispatcher = new CommandDispatcher({
      projectId,
      store,
      mailbox: busyMailbox,
      subject: SUBJECT,
    });
    busyDispatcher.register<BumpParams, unknown>({
      method: 'test.budget.bump',
      kind: 'write',
      handle: () => {
        throw new Error('must not run');
      },
    });
    const first = busyDispatcher.dispatch(request({ idempotencyKey: 'busy-1' }));
    const second = await busyDispatcher.dispatch(
      request({ id: 'req-6', idempotencyKey: 'busy-2' }),
    );
    expect(second).toMatchObject({ ok: false, error: { code: 'BUSY', retryable: true } });
    await first;
    expect(store.commands.lookup(SUBJECT, 'test.budget.bump', 'busy-2')).toBeUndefined();
  });
});

describe('long operations do not block commands (AC-056)', () => {
  it('answers a command within a second while a model call is in flight', async () => {
    let release: (() => void) | undefined;
    const effect = mailbox.runEffect({
      label: 'model.call:chief',
      run: () =>
        new Promise<string>((resolve) => {
          release = () => resolve('done');
        }),
    });
    await Promise.resolve();

    const started = Date.now();
    const response = await dispatcher.dispatch(
      request({ id: 'req-live', idempotencyKey: 'key-live' }),
    );
    const elapsed = Date.now() - started;

    expect(response).toMatchObject({ ok: true, result: { status: 'applied' } });
    expect(elapsed).toBeLessThan(1000);
    expect(mailbox.activeEffects()).toEqual(['model.call:chief']);

    release?.();
    await effect;
  });
});

describe('canonical payload hashing', () => {
  it('is stable across key order and nested structures', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson(null)).toBe('null');
  });
});
