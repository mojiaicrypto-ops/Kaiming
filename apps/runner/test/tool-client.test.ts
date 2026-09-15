/**
 * T3.2 — the `tool.execute` transport: idempotency derivation, timeouts and refusals.
 *
 * Everything here uses an injected `fetch` that records the exact request, so the
 * assertions are about the wire contract (what Core receives) rather than about HTTP
 * plumbing; the real endpoint is exercised in `packages/core/test/tool-http.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { LIMITS } from '@agentdev/contracts';
import { createHash } from 'node:crypto';
import { READ_LEDGER_SEAL_GENESIS } from '@agentdev/contracts';
import {
  createToolClient,
  derivedToolOperationId,
  emptyReadLedgerBinding,
  toolInputHash,
} from '../src/tool-client.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
  readonly authorization: string;
}

/** What the fetch stub does for one request. */
type StubAnswer = { readonly status: number; readonly body: unknown } | { readonly throws: string };

/** A fetch stub that answers a queue of responses and records every request. */
function stubFetch(answers: readonly StubAnswer[]): {
  fetchImpl: typeof fetch;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  let index = 0;
  const fetchImpl = ((url: string, init: RequestInit) => {
    requests.push({
      url: String(url),
      method: String(init.method),
      body: JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>,
      authorization: String((init.headers as Record<string, string>)['authorization']),
    });
    const answer = answers[Math.min(index, answers.length - 1)] ?? { status: 200, body: {} };
    index += 1;
    if ('throws' in answer) return Promise.reject(new Error(answer.throws));
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function client(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return createToolClient({
    url: 'http://127.0.0.1:51234',
    capability: 'cap-1',
    attemptId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e50',
    epoch: 3,
    role: 'backend',
    fetchImpl,
    ...overrides,
  });
}

describe('idempotency derivation', () => {
  it('hashes arguments with the canonical JSON rule, independent of key order', () => {
    expect(toolInputHash({ b: 1, a: 2 })).toBe(toolInputHash({ a: 2, b: 1 }));
    expect(toolInputHash({ a: 1 })).toMatch(SHA256);
  });

  it('derives a contract-shaped, stable tool-operation id', () => {
    const id = derivedToolOperationId('seed');
    expect(id).toMatch(UUID_V7);
    expect(derivedToolOperationId('seed')).toBe(id);
    expect(derivedToolOperationId('other')).not.toBe(id);
  });

  it('keeps one id for one Pi tool call and a new id for a new call', () => {
    const instance = client(stubFetch([{ status: 200, body: {} }]).fetchImpl);
    const first = instance.derive({ toolName: 'read', args: { path: 'a' }, toolCallId: 'call-1' });
    const retry = instance.derive({ toolName: 'read', args: { path: 'a' }, toolCallId: 'call-1' });
    const second = instance.derive({ toolName: 'read', args: { path: 'a' }, toolCallId: 'call-2' });
    expect(retry).toEqual(first);
    expect(second.toolOperationId).not.toBe(first.toolOperationId);
    // A different tool with the same call id is a different operation.
    expect(
      instance.derive({ toolName: 'edit', args: { path: 'a' }, toolCallId: 'call-1' })
        .toolOperationId,
    ).not.toBe(first.toolOperationId);
  });
});

describe('tool call transport', () => {
  it('sends the documented body shape with the attempt capability', async () => {
    const stub = stubFetch([
      {
        status: 200,
        body: { v: 1, status: 'executed', result: 'hello', resultRef: null, truncated: false },
      },
    ]);
    const result = await client(stub.fetchImpl).call({
      toolName: 'read',
      args: { path: 'src/a.ts' },
      toolCallId: 'call-1',
    });
    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0];
    expect(request?.url).toBe('http://127.0.0.1:51234/control/tool.execute');
    expect(request?.authorization).toBe('Bearer cap-1');
    expect(request?.body).toMatchObject({
      attemptId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e50',
      epoch: 3,
      toolName: 'read',
      args: { path: 'src/a.ts' },
      timeoutMs: LIMITS.shellTimeoutSec.default * 1000,
    });
    expect(String(request?.body['toolOperationId'])).toMatch(UUID_V7);
    expect(request?.body['expectedInputHash']).toBe(toolInputHash({ path: 'src/a.ts' }));
    expect(result.status).toBe('executed');
    expect(result.text).toBe('hello');
  });

  it('renders a deferred result with its reference', async () => {
    const stub = stubFetch([
      {
        status: 200,
        body: {
          v: 1,
          status: 'replayed',
          result: { preview: 'x' },
          resultRef: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e99',
          truncated: true,
        },
      },
    ]);
    const result = await client(stub.fetchImpl).call({
      toolName: 'bash',
      args: { command: 'ls' },
      toolCallId: 'call-1',
    });
    expect(result.status).toBe('replayed');
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('resultRef 018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e99');
  });

  it('reports a refusal as an error carrying the protocol code, without retrying', async () => {
    const stub = stubFetch([
      { status: 401, body: { error: { code: 'NOT_AUTHORIZED', message: 'no Grant admits this' } } },
    ]);
    const result = await client(stub.fetchImpl).call({
      toolName: 'edit',
      args: { path: 'src/a.ts', content: 'x' },
      toolCallId: 'call-1',
    });
    expect(stub.requests).toHaveLength(1);
    expect(result.isError).toBe(true);
    expect(result.code).toBe('NOT_AUTHORIZED');
    expect(result.text).toBe('NOT_AUTHORIZED: no Grant admits this');
  });

  it('retries once when no response arrived, then reports the failure', async () => {
    const stub = stubFetch([{ throws: 'socket hang up' }, { throws: 'socket hang up' }]);
    const result = await client(stub.fetchImpl).call({
      toolName: 'read',
      args: { path: 'a' },
      toolCallId: 'call-1',
    });
    expect(stub.requests).toHaveLength(2);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('TOOL_UNREACHABLE');
  });

  it('recovers when the second attempt answers', async () => {
    const stub = stubFetch([
      { throws: 'connection reset' },
      { status: 200, body: { status: 'replayed', result: 'from the ledger', truncated: false } },
    ]);
    const result = await client(stub.fetchImpl).call({
      toolName: 'read',
      args: { path: 'a' },
      toolCallId: 'call-1',
    });
    expect(stub.requests).toHaveLength(2);
    // The retry reuses the same operation id, so Core answers with the recorded result.
    expect(stub.requests[0]?.body['toolOperationId']).toBe(
      stub.requests[1]?.body['toolOperationId'],
    );
    expect(result.status).toBe('replayed');
    expect(result.text).toBe('from the ledger');
  });

  it('honours a per-call timeout override', async () => {
    const stub = stubFetch([{ status: 200, body: { status: 'executed', result: 'ok' } }]);
    await client(stub.fetchImpl).call({
      toolName: 'bash',
      args: { command: 'make test' },
      toolCallId: 'call-1',
      timeoutMs: 1_800_000,
    });
    expect(stub.requests[0]?.body['timeoutMs']).toBe(1_800_000);
  });

  it('asks for permission when the Broker refuses the call, then tells the model to wait', async () => {
    const stub = stubFetch([
      {
        status: 401,
        body: { error: { code: 'NOT_AUTHORIZED', message: 'no Grant admits this call' } },
      },
      {
        status: 200,
        body: { status: 'waiting_permission', decisionId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e77' },
      },
    ]);
    const result = await client(stub.fetchImpl).execute({
      toolName: 'bash',
      args: { command: 'make test' },
      toolCallId: 'call-1',
      signal: undefined,
    });
    expect(stub.requests).toHaveLength(2);
    expect(stub.requests[1]?.url).toBe('http://127.0.0.1:51234/control/permission.request');
    expect(stub.requests[1]?.body).toMatchObject({
      attemptId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e50',
      epoch: 3,
      toolName: 'bash',
      args: { command: 'make test' },
    });
    // Both requests name the same operation, so the approval can only admit this call.
    expect(stub.requests[1]?.body['toolOperationId']).toBe(
      stub.requests[0]?.body['toolOperationId'],
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no Grant admits this call');
    expect(result.text).toContain('decision 018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e77');
    expect(result.text).toContain('wait for the user');
  });

  it('keeps the refusal text when the permission request itself fails', async () => {
    const stub = stubFetch([
      {
        status: 401,
        body: { error: { code: 'NOT_AUTHORIZED', message: 'no Grant admits this call' } },
      },
      { status: 503, body: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'no handler' } } },
    ]);
    const result = await client(stub.fetchImpl).execute({
      toolName: 'bash',
      args: { command: 'make test' },
      toolCallId: 'call-1',
      signal: undefined,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toBe('NOT_AUTHORIZED: no Grant admits this call');
  });

  it('does not open a permission request for a phase-1 hard block (AC-048/AC-049)', async () => {
    // `T3-implementation.md` 附录 A.1/A.4: a sensitive file, a loopback/metadata target, an
    // outside-workspace delete or a Git-ref change is refused by policy, not by a missing
    // Grant. Recording a decision for it would park the Run on something no approval could
    // admit, so the endpoint marks it `approvable: false` and the client hands the typed
    // refusal straight to the model — the "zero prompts during a run" half of W1.
    const stub = stubFetch([
      {
        status: 403,
        body: {
          error: {
            code: 'CONTEXT_FORBIDDEN',
            message: 'refused: .env matches the frozen sensitive-file pattern',
            details: { approvable: false, pattern: '.env*', path: '.env', configPolicy: 'strict' },
          },
        },
      },
    ]);
    const result = await client(stub.fetchImpl).execute({
      toolName: 'read',
      args: { path: '.env' },
      toolCallId: 'call-1',
      signal: undefined,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('CONTEXT_FORBIDDEN');
    expect(result.text).toContain('frozen sensitive-file pattern');
    // Exactly one request, and it is not a permission request: the stub would answer any
    // second request from the same entry, so a permission attempt is visible here.
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.url).toBe('http://127.0.0.1:51234/control/tool.execute');
  });

  it('reuses the refused identity for the retry after the approval, and only for the same call', async () => {
    // `protocol.md` §4: the user approves *this* call, the model retries it. A retry is a new
    // SDK tool call with a new call id, so an id derived from the call id would name a second
    // operation and the approved `once` Grant could never admit it (WP-12 R7).
    const stub = stubFetch([
      {
        status: 401,
        body: { error: { code: 'NOT_AUTHORIZED', message: 'no Grant admits this call' } },
      },
      { status: 200, body: { status: 'waiting_permission', decisionId: 'decision-1' } },
      { status: 200, body: { status: 'executed', result: { inline: 'approved-by-the-user' } } },
    ]);
    const instance = client(stub.fetchImpl);
    const refused = await instance.execute({
      toolName: 'bash',
      args: { command: 'make test' },
      toolCallId: 'call-1',
      signal: undefined,
    });
    expect(refused.isError).toBe(true);
    // The retry is a *different* Pi tool call (new call id) with the same arguments.
    const retried = await instance.call({
      toolName: 'bash',
      args: { command: 'make test' },
      toolCallId: 'call-2',
    });
    expect(retried.isError).toBeUndefined();
    expect(stub.requests[2]?.body['toolOperationId']).toBe(
      stub.requests[1]?.body['toolOperationId'],
    );
    // Different arguments are their own operation: the approved call cannot be re-pointed.
    await instance.call({
      toolName: 'bash',
      args: { command: 'make other' },
      toolCallId: 'call-3',
    });
    expect(stub.requests[3]?.body['toolOperationId']).not.toBe(
      stub.requests[1]?.body['toolOperationId'],
    );
    expect(stub.requests[3]?.body['expectedInputHash']).not.toBe(
      stub.requests[1]?.body['inputHash'],
    );
  });

  it('does not ask for permission on a correctable refusal', async () => {
    const stub = stubFetch([
      { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'args are invalid' } } },
    ]);
    const result = await client(stub.fetchImpl).execute({
      toolName: 'read',
      args: { path: 'a' },
      toolCallId: 'call-1',
      signal: undefined,
    });
    expect(stub.requests).toHaveLength(1);
    expect(result.text).toBe('VALIDATION_ERROR: args are invalid');
  });

  it('starts at the derived empty read-ledger binding, not a placeholder (AC-085)', () => {
    const instance = client(stubFetch([{ status: 200, body: {} }]).fetchImpl);
    const empty = emptyReadLedgerBinding();
    expect(instance.readLedgerBinding()).toEqual(empty);
    expect(empty.seq).toBe(0);
    expect(empty.hash).toBe(createHash('sha256').update(READ_LEDGER_SEAL_GENESIS).digest('hex'));
    // A placeholder must not pass as the empty seal.
    expect(empty.hash).not.toBe('0'.repeat(64));
    expect(empty.hash).not.toBe('a'.repeat(64));
  });

  it('adopts the binding Core reports with each answer', async () => {
    const binding = { seq: 2, hash: 'c'.repeat(64) };
    const stub = stubFetch([
      {
        status: 200,
        body: {
          v: 1,
          status: 'executed',
          result: 'file body',
          resultRef: null,
          truncated: false,
          ledger: binding,
        },
      },
      // A malformed binding is ignored: the last good one stands.
      { status: 200, body: { status: 'executed', result: 'x', ledger: { seq: -1, hash: 'nope' } } },
    ]);
    const instance = client(stub.fetchImpl);
    const first = await instance.call({
      toolName: 'read',
      args: { path: 'a' },
      toolCallId: 'call-1',
    });
    expect(first.ledger).toEqual(binding);
    expect(instance.readLedgerBinding()).toEqual(binding);
    await instance.call({ toolName: 'read', args: { path: 'b' }, toolCallId: 'call-2' });
    expect(instance.readLedgerBinding()).toEqual(binding);
  });

  it('implements the ToolBridge the registry binds', async () => {
    const stub = stubFetch([{ status: 200, body: { status: 'executed', result: 'file body' } }]);
    const bridge = client(stub.fetchImpl);
    const result = await bridge.execute({
      toolName: 'read',
      args: { path: 'src/a.ts' },
      toolCallId: 'call-1',
      signal: undefined,
    });
    expect(result).toEqual({ text: 'file body' });
    const failure = await bridge.execute({
      toolName: 'read',
      args: { path: 'src/a.ts' },
      toolCallId: 'call-2',
      signal: undefined,
    });
    // The stub repeats its last answer, so this call succeeds too; the shape is what
    // matters: `roleTools` receives exactly `{text, isError?}`.
    expect(typeof failure.text).toBe('string');
  });
});
