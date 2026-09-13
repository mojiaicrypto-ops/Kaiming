/**
 * Command round-trips, error mapping, reconnect backoff and write retry.
 *
 * AC-054 (UI断开) and AC-078 (认证生命周期): a dropped socket does not stop the
 * background work, queued writes are replayed with the same idempotency key while
 * the caller can tell the answer was a replay, and an unauthorised request is
 * refused without any retry.
 */
import { describe, expect, it } from 'vitest';
import { ClientError, ProtocolConnection } from '../src/index.js';
import { TestClock, createHarness, flush } from './helpers.js';

describe('connection and commands', () => {
  it('completes connection.hello before any other request', async () => {
    const { client, server } = createHarness();
    await client.connect();
    expect(client.state).toBe('open');
    expect(client.connection).toBe('connection-1');
    expect(server.requests.map((request) => request.method)).toEqual(['connection.hello']);
    client.end();
  });

  it('round-trips a read and preserves the result verbatim', async () => {
    const { client, server } = createHarness({
      onRead: (message) =>
        message.method === 'project.list'
          ? { status: 'ok', result: { items: [{ id: 'p1' }], nextCursor: 'opaque' } }
          : undefined,
    });
    await client.connect();
    const result = await client.command<{ items: unknown[]; nextCursor: string }>('project.list', {
      filter: 'recent',
    });
    expect(result.nextCursor).toBe('opaque');
    expect(result.items).toHaveLength(1);
    const request = server.requests.find((entry) => entry.method === 'project.list');
    expect(request?.params).toEqual({ filter: 'recent' });
    client.end();
  });

  it('maps a failed response onto a typed ClientError with the protocol code', async () => {
    const { client } = createHarness({
      onRead: (message) =>
        message.method === 'work.get'
          ? { status: 'error', code: 'VERSION_CONFLICT', details: { currentVersion: 7 } }
          : undefined,
    });
    await client.connect();
    let error: ClientError | undefined;
    try {
      await client.command('work.get', { workId: 'missing' });
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error).toBeInstanceOf(ClientError);
    expect(error?.code).toBe('VERSION_CONFLICT');
    expect(error?.retryable).toBe(false);
    expect(error?.details).toEqual({ currentVersion: 7 });
    expect(error?.canRetry).toBe(false);
    client.end();
  });

  it('refuses a write sent through command() and a read sent through write()', async () => {
    const { client } = createHarness();
    await client.connect();
    await expect(client.command('work.pause', { workId: 'w', reason: 'r' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      client.write('work.get', { workId: 'w' }, { idempotencyKey: 'k1', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    client.end();
  });

  it('rejects write fields outside the documented bounds', async () => {
    const { client } = createHarness();
    await client.connect();
    await expect(
      client.write('work.pause', { workId: 'w' }, { idempotencyKey: '', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      client.write('work.pause', { workId: 'w' }, { idempotencyKey: 'k', expectedVersion: -1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    client.end();
  });

  it('rejects a command while the connection is not open', async () => {
    const { client } = createHarness();
    await expect(client.command('project.list', {})).rejects.toMatchObject({
      code: 'TRANSPORT_CLOSED',
    });
  });
});

describe('AC-054 reconnect and bounded backoff', () => {
  it('reconnects on the documented schedule and replays the hello', async () => {
    const { client, server, clientTransport, clock, states } = createHarness();
    await client.connect();
    expect(client.connection).toBe('connection-1');

    clientTransport.drop(1006, 'network lost');
    await flush();
    expect(client.state).toBe('reconnecting');
    expect(clock.nextDelay()).toBe(1_000);

    await clock.advance(1_000);
    await flush();
    expect(client.state).toBe('open');
    expect(server.requests.filter((entry) => entry.method === 'connection.hello')).toHaveLength(2);
    expect(states.map((status) => status.state)).toEqual([
      'connecting',
      'open',
      'reconnecting',
      'open',
    ]);
    client.end();
  });

  it('applies bounded exponential backoff while every reconnect fails', async () => {
    const clock = new TestClock();
    const { client, clientTransport } = createHarness({ clock, maxReconnectAttempts: 3 });
    await client.connect();
    // Every reconnect is refused by the peer.
    clientTransport.subscribe({
      onOpen: () => clientTransport.drop(1006, 'refused'),
      onMessage: () => undefined,
      onClose: () => undefined,
      onError: () => undefined,
    });
    clientTransport.drop(1006, 'network lost');
    await flush();

    const delays: number[] = [];
    for (let step = 0; step < 4; step += 1) {
      const delay = clock.nextDelay();
      if (delay === undefined) break;
      delays.push(delay);
      await clock.advance(delay);
      await flush();
    }
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(client.state).toBe('closed');
    client.end();
  });

  it('reports the attempt number while reconnecting and ends at the limit', async () => {
    const clock = new TestClock();
    const { client, clientTransport, states } = createHarness({ clock, maxReconnectAttempts: 2 });
    await client.connect();
    clientTransport.subscribe({
      onOpen: () => clientTransport.drop(1006, 'refused'),
      onMessage: () => undefined,
      onClose: () => undefined,
      onError: () => undefined,
    });
    clientTransport.drop(1006, 'network lost');
    await flush();
    const reconnecting = states.filter((status) => status.state === 'reconnecting');
    expect(reconnecting).toHaveLength(1);
    expect(reconnecting[0]?.attempt).toBe(0);
    for (let step = 0; step < 3; step += 1) {
      const delay = clock.nextDelay();
      if (delay === undefined) break;
      await clock.advance(delay);
      await flush();
    }
    expect(client.state).toBe('closed');
    expect(states.map((status) => status.state)).toEqual([
      'connecting',
      'open',
      'reconnecting',
      'reconnecting',
      'closed',
    ]);
    client.end();
  });
});

describe('AC-054 write retry with the same idempotency key', () => {
  it('replays a write whose answer was lost and reports the replay', async () => {
    let dropAnswer = true;
    const { client, server, clientTransport, clock } = createHarness({
      dropServerFrames: (frame) => {
        if (!dropAnswer) return false;
        if (!frame.includes('"ok":true') || !frame.includes('"status":"applied"')) return false;
        dropAnswer = false;
        return true;
      },
    });
    await client.connect();

    const pending = client.write<{ status: string; version: number }>(
      'work.pause',
      { workId: 'work-1', reason: 'user' },
      { idempotencyKey: 'idem-1', expectedVersion: 3 },
    );
    await flush();
    // The server applied the write; only the answer was lost.
    expect(server.writeKeys).toEqual(['idem-1']);

    clientTransport.drop(1006, 'network lost');
    await flush();
    expect(client.state).toBe('reconnecting');
    await clock.advance(1_000);
    await flush();

    const receipt = await pending;
    expect(receipt.replayed).toBe(true);
    expect(receipt.result.status).toBe('applied');
    expect(receipt.transportAttempts).toBe(2);
    // The retry carried the same key and the same payload: two sends, one effect.
    expect(server.writeKeys).toEqual(['idem-1', 'idem-1']);
    const frames = server.rawFrames
      .filter((frame) => frame.includes('"method":"work.pause"'))
      .map((frame) => JSON.parse(frame) as { params: Record<string, unknown> });
    expect(frames).toHaveLength(2);
    expect(frames[0]?.params).toEqual(frames[1]?.params);
    expect(frames[0]?.params).toMatchObject({ idempotencyKey: 'idem-1', expectedVersion: 3 });
    // The idempotent server answered the original result, not a second apply.
    expect(receipt.result.version).toBe(1);
    client.end();
  });

  it('queues a write that never reached the wire and replays it after reconnect', async () => {
    const { client, server, clientTransport, clock } = createHarness();
    await client.connect();
    // The frame is dropped before the peer sees it: an at-most-once send. The
    // socket then dies, so the write is queued rather than silently lost.
    clientTransport.dropNextSends(1);
    const pending = client.write(
      'work.pause',
      { workId: 'work-1', reason: 'user' },
      { idempotencyKey: 'idem-queued', expectedVersion: 2 },
    );
    await flush();
    expect(server.writeKeys).toEqual([]);
    clientTransport.drop(1006, 'network lost');
    await flush();
    expect(client.queuedWrites).toBe(1);
    await clock.advance(1_000);
    await flush();
    const receipt = await pending;
    expect(receipt.replayed).toBe(true);
    expect(server.writeKeys).toEqual(['idem-queued']);
    client.end();
  });

  it('retries a BUSY write with backoff and the same key', async () => {
    let busy = true;
    const { client, server, clock } = createHarness({
      onWrite: (message) => {
        if (message.method !== 'work.pause' || !busy) return undefined;
        busy = false;
        return { status: 'error', code: 'BUSY', retryable: true };
      },
    });
    await client.connect();
    const pending = client.write(
      'work.pause',
      { workId: 'work-1', reason: 'user' },
      { idempotencyKey: 'idem-busy', expectedVersion: 1 },
    );
    await flush();
    expect(clock.nextDelay()).toBe(1_000);
    await clock.advance(1_000);
    const receipt = await pending;
    expect(receipt.replayed).toBe(true);
    expect(server.writeKeys).toEqual(['idem-busy', 'idem-busy']);
    client.end();
  });

  it('reports a first-attempt write as not replayed', async () => {
    const { client } = createHarness();
    await client.connect();
    const receipt = await client.write(
      'work.pause',
      { workId: 'work-1', reason: 'user' },
      { idempotencyKey: 'idem-fresh', expectedVersion: 1 },
    );
    expect(receipt.replayed).toBe(false);
    expect(receipt.transportAttempts).toBe(1);
    client.end();
  });

  it('fails a queued write when the client ends before a socket returns', async () => {
    const { client, clientTransport } = createHarness();
    await client.connect();
    clientTransport.drop(1006, 'network lost');
    await flush();
    const pending = client.write(
      'work.pause',
      { workId: 'work-1', reason: 'user' },
      { idempotencyKey: 'idem-ended', expectedVersion: 1 },
    );
    pending.catch(() => undefined);
    await flush();
    expect(client.queuedWrites).toBe(1);
    client.end();
    let error: ClientError | undefined;
    try {
      await pending;
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.code).toBe('TRANSPORT_CLOSED');
    expect(client.queuedWrites).toBe(0);
  });
});

describe('AC-078 authentication lifecycle', () => {
  it('surfaces an expired session as a typed error without retrying', async () => {
    const { client, server } = createHarness({
      onWrite: (message) =>
        message.method === 'work.pause' ? { status: 'error', code: 'AUTH_EXPIRED' } : undefined,
    });
    await client.connect();
    let error: ClientError | undefined;
    try {
      await client.write(
        'work.pause',
        { workId: 'work-1', reason: 'user' },
        { idempotencyKey: 'idem-auth', expectedVersion: 1 },
      );
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error).toBeInstanceOf(ClientError);
    expect(error?.code).toBe('AUTH_EXPIRED');
    expect(error?.isAuthenticationError).toBe(true);
    expect(error?.canRetry).toBe(false);
    expect(server.writeKeys).toEqual(['idem-auth']);
    client.end();
  });

  it('never retries a NOT_AUTHORIZED write', async () => {
    const { client, server } = createHarness({
      onWrite: (message) =>
        message.method === 'work.pause' ? { status: 'error', code: 'NOT_AUTHORIZED' } : undefined,
    });
    await client.connect();
    let error: ClientError | undefined;
    try {
      await client.write(
        'work.pause',
        { workId: 'work-1', reason: 'user' },
        { idempotencyKey: 'idem-denied', expectedVersion: 1 },
      );
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.isAuthorizationError).toBe(true);
    expect(error?.retryable).toBe(false);
    expect(server.writeKeys).toEqual(['idem-denied']);
    client.end();
  });

  it('does not reconnect when the handshake itself is refused', async () => {
    const clock = new TestClock();
    const { client } = createHarness({
      clock,
      onRead: (message) =>
        message.method === 'connection.hello'
          ? { status: 'error', code: 'AUTH_EXPIRED' }
          : undefined,
    });
    let error: ClientError | undefined;
    try {
      await client.connect();
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.code).toBe('AUTH_EXPIRED');
    expect(client.state).toBe('closed');
    expect(clock.nextDelay()).toBeUndefined();
    client.end();
  });
});

describe('ProtocolConnection protocol surface', () => {
  it('separates reads from writes with the shared method table', () => {
    expect(ProtocolConnection.isRead('project.list')).toBe(true);
    expect(ProtocolConnection.isRead('command.get')).toBe(true);
    expect(ProtocolConnection.isRead('work.pause')).toBe(false);
    expect(ProtocolConnection.isRead('requirement.create')).toBe(false);
  });
});
