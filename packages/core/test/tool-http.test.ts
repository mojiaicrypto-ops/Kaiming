/**
 * T3.2 — the `tool.execute` endpoint handler (AC-048/AC-080).
 *
 * The endpoint's own contract is proved here: shape validation, the recomputed input
 * hash, the two documented result shapes, the protocol error envelope and the
 * `tool.refused` audit row the endpoint must write even when no Grant was consulted.
 * A real SQLite store is used so the audit assertions are about persisted events.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOOL_RESULT_INLINE_BYTES, type Grant, type ToolOperation } from '@agentdev/contracts';
import { projectIdFromRoot, ProjectStore as Store, type ProjectStore } from '@agentdev/storage';
import { TOOL_EVENTS, hashToolInput, type ToolSuccess } from '../src/broker.js';
import { ProtocolError } from '../src/errors.js';
import { scanEvents } from '../src/events.js';
import { handleToolExecute, toolExecuteBody, type ToolExecuteHandler } from '../src/tool-http.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e00';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e10';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e50';
const OP_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e60';
const GRANT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e70';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d8e30';
const HASH = 'a'.repeat(64);

const CALLER = {
  runId: RUN_ID,
  attemptId: ATTEMPT_ID,
  epoch: 1,
  role: 'backend' as const,
};

function toolOperation(overrides: Partial<ToolOperation> = {}): ToolOperation {
  return {
    id: OP_ID,
    projectId: '0'.repeat(32),
    version: 1,
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:01.000Z',
    workId: WORK_ID,
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    epoch: 1,
    toolName: 'read',
    inputHash: HASH,
    argsRef: OP_ID,
    targets: ['src/a.ts'],
    state: 'finished',
    grantId: GRANT_ID,
    resultRef: OP_ID,
    ...overrides,
  };
}

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: GRANT_ID,
    projectId: '0'.repeat(32),
    version: 2,
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: '2026-09-11T00:00:00.000Z',
    workId: WORK_ID,
    runId: RUN_ID,
    scope: 'run',
    role: 'backend',
    stage: 'develop-L2',
    operation: 'read',
    targets: [],
    expiresAt: '2026-09-11T01:00:00.000Z',
    limits: {},
    decisionId: DECISION_ID,
    consumedAt: '2026-09-11T00:00:01.000Z',
    consumedByOperationId: OP_ID,
    inputHash: HASH,
    ...overrides,
  };
}

function success(result: unknown, overrides: Partial<ToolSuccess> = {}): ToolSuccess {
  return {
    ok: true,
    outcome: 'executed',
    mode: 'host',
    operation: 'read',
    inputHash: HASH,
    toolOperationId: OP_ID,
    grantId: GRANT_ID,
    result,
    toolOperation: toolOperation(),
    grant: grant(),
    ...overrides,
  };
}

describe('tool.execute endpoint handler', () => {
  let dataDir: string;
  let store: ProjectStore;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-toolhttp-'));
    store = Store.open({
      dataDir,
      canonicalRoot: dataDir,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    store.projects.insert({
      id: projectIdFromRoot(dataDir),
      root: dataDir,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function options(handler: ToolExecuteHandler) {
    return {
      store,
      handler,
      newToolOperationId: () => OP_ID,
    };
  }

  /** A handler that records what it was asked and answers a fixed success. */
  function recordingHandler(result: unknown, overrides: Partial<ToolSuccess> = {}) {
    const calls: Array<Record<string, unknown>> = [];
    const handler: ToolExecuteHandler = {
      execute: (input) => {
        calls.push({ ...input.request, callerRole: input.caller.role });
        return Promise.resolve(success(result, overrides));
      },
    };
    return { handler, calls };
  }

  it('accepts the documented body and returns the inline result shape', async () => {
    const { handler, calls } = recordingHandler('file contents');
    const answer = await handleToolExecute(options(handler), CALLER, {
      toolName: 'read',
      args: { path: 'src/a.ts' },
      expectedInputHash: hashToolInput({ path: 'src/a.ts' }),
      toolOperationId: OP_ID,
    });
    expect(answer.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(answer.body).toMatchObject({
      v: 1,
      status: 'executed',
      mode: 'host',
      operation: 'read',
      toolName: 'read',
      toolOperationId: OP_ID,
      inputHash: HASH,
      grantId: GRANT_ID,
      result: 'file contents',
      resultRef: null,
      truncated: false,
    });
  });

  it('carries the Attempt read-ledger binding when the handler supplies one (AC-085)', () => {
    const binding = { seq: 3, hash: 'd'.repeat(64) };
    const body = toolExecuteBody({ ...success('file body'), ledger: binding }, 5);
    expect(body['ledger']).toEqual(binding);
    // Without a ledger the member is absent rather than invented.
    expect(toolExecuteBody(success('file body'), 5)['ledger']).toBeUndefined();
  });

  it('defers a large result and names the Ref', () => {
    const big = 'x'.repeat(TOOL_RESULT_INLINE_BYTES + 100);
    const body = toolExecuteBody(success(big), 12);
    expect(body['truncated']).toBe(true);
    expect(body['resultRef']).toBe(OP_ID);
    expect(String(body['result']).length).toBe(TOOL_RESULT_INLINE_BYTES);
    expect(body['durationMs']).toBe(12);
  });

  it('refuses unknown fields with VALIDATION_ERROR and audits the refusal', async () => {
    const { handler, calls } = recordingHandler('nope');
    const answer = await handleToolExecute(options(handler), CALLER, {
      toolName: 'read',
      args: { path: 'a' },
      toolname: 'bash',
    });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(calls).toHaveLength(0);
    const refusalsFound = scanEvents(store, { names: [TOOL_EVENTS.refused] });
    expect(refusalsFound.length).toBeGreaterThan(0);
    expect(refusalsFound[0]?.data).toMatchObject({ runId: RUN_ID, layer: 'endpoint' });
  });

  it('rejects a mismatched expectedInputHash as IDEMPOTENCY_CONFLICT without running', async () => {
    const { handler, calls } = recordingHandler('nope');
    const answer = await handleToolExecute(options(handler), CALLER, {
      toolName: 'read',
      args: { path: 'a' },
      expectedInputHash: 'b'.repeat(64),
      toolOperationId: OP_ID,
    });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(calls).toHaveLength(0);
  });

  it('bounds the requested timeout by the documented ceiling', async () => {
    const { handler } = recordingHandler('x');
    const tooLong = await handleToolExecute(options(handler), CALLER, {
      toolName: 'bash',
      args: { command: 'ls' },
      timeoutMs: 3_600_000,
    });
    expect(tooLong.status).toBe(400);
    const zero = await handleToolExecute(options(handler), CALLER, {
      toolName: 'bash',
      args: { command: 'ls' },
      timeoutMs: 0,
    });
    expect(zero.status).toBe(400);
  });

  it('defaults the timeout to the documented value', async () => {
    const { handler, calls } = recordingHandler('x');
    await handleToolExecute(options(handler), CALLER, {
      toolName: 'bash',
      args: { command: 'ls' },
    });
    expect(calls[0]?.['timeoutMs']).toBe(120_000);
  });

  it('maps a handler refusal onto the protocol status and code', async () => {
    const handler: ToolExecuteHandler = {
      execute: () =>
        Promise.reject(
          new ProtocolError('NOT_AUTHORIZED', 'no Grant admits this tool call', {
            details: { toolOperationId: OP_ID },
          }),
        ),
    };
    const answer = await handleToolExecute(options(handler), CALLER, {
      toolName: 'edit',
      args: { path: 'src/a.ts', content: 'x' },
      toolOperationId: OP_ID,
    });
    expect(answer.status).toBe(401);
    expect(answer.body).toMatchObject({
      error: { code: 'NOT_AUTHORIZED', message: 'no Grant admits this tool call' },
    });
    expect(scanEvents(store, { names: [TOOL_EVENTS.refused] }).length).toBeGreaterThan(0);
  });

  it('never leaks an unexpected error message or stack', async () => {
    const handler: ToolExecuteHandler = {
      execute: () => Promise.reject(new Error('secret provider:xyz is not available')),
    };
    const answer = await handleToolExecute(options(handler), CALLER, {
      toolName: 'read',
      args: { path: 'a' },
      toolOperationId: OP_ID,
    });
    expect(answer.status).toBe(500);
    expect(JSON.stringify(answer.body)).not.toContain('provider:xyz');
    expect(answer.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
  });

  it('generates a tool-operation id when the caller omitted one', async () => {
    const { handler, calls } = recordingHandler('x');
    const answer = await handleToolExecute(
      options(handler),
      CALLER,
      {
        toolName: 'read',
        args: { path: 'a' },
      },
      undefined,
    );
    expect(answer.status).toBe(200);
    expect(calls[0]?.['toolOperationId']).toBe(OP_ID);
  });
});
