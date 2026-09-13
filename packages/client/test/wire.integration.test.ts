/**
 * The real wire: `WebSocketTransport` against an RFC6455 server on loopback.
 *
 * AC-054 and AC-078 both depend on the transport behaving like a browser socket:
 * `connection.hello` first, ordered event delivery, watermark resume, and a
 * handshake refusal that surfaces as a typed error instead of a retry storm.
 * The server below is a minimal hand-written RFC6455 endpoint (Node has no
 * WebSocket server built in and this package adds no dependency), bound to
 * 127.0.0.1:0 so the test stays offline.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClientError,
  ProtocolClient,
  WebSocketTransport,
  parseEventFrame,
  type EventEnvelope,
} from '../src/index.js';
import { TestClock, flush } from './helpers.js';

const PROJECT = '0123456789abcdef0123456789abcdef';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

interface DecodedFrame {
  readonly opcode: number;
  readonly text: string;
}

/** Writes one unmasked RFC6455 frame (a server frame is never masked). */
function frame(payload: string): Buffer {
  const body = Buffer.from(payload, 'utf8');
  if (body.byteLength < 126) {
    return Buffer.concat([Buffer.from([0x81, body.byteLength]), body]);
  }
  if (body.byteLength < 65_536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(body.byteLength, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(body.byteLength), 2);
  return Buffer.concat([header, body]);
}

/** Accumulates bytes and yields whole client frames (always masked). */
class FrameReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): DecodedFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: DecodedFrame[] = [];
    for (;;) {
      const decoded = this.take();
      if (decoded === undefined) return frames;
      frames.push(decoded);
    }
  }

  private take(): DecodedFrame | undefined {
    const buffer = this.buffer;
    if (buffer.byteLength < 2) return undefined;
    const first = buffer[0] ?? 0;
    const second = buffer[1] ?? 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.byteLength < offset + 2) return undefined;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffer.byteLength < offset + 8) return undefined;
      length = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }
    let mask: Buffer | undefined;
    if (masked) {
      if (buffer.byteLength < offset + 4) return undefined;
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buffer.byteLength < offset + length) return undefined;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    if (mask !== undefined) {
      for (let index = 0; index < payload.byteLength; index += 1) {
        payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
      }
    }
    this.buffer = buffer.subarray(offset + length);
    return { opcode, text: payload.toString('utf8') };
  }
}

interface WireServerOptions {
  /** Required cookie value; any other request is refused with 403. */
  readonly cookie?: string;
  /** Required Origin; any other request is refused with 403. */
  readonly origin?: string;
  /** Answers a request frame; return `undefined` to ignore it. */
  readonly onRequest: (message: RequestFrame) => WireReply | undefined;
}

interface RequestFrame {
  readonly id: string;
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly projectId?: string;
}

type WireReply =
  | { readonly result: unknown }
  | { readonly error: { code: string; message: string; retryable?: boolean } };

interface WireConnection {
  readonly request: IncomingMessage;
  /** Sends one text frame to this client. */
  send(payload: string): void;
  close(code?: number): void;
}

/** A minimal RFC6455 server used only by these tests. */
class WireServer {
  readonly frames: string[] = [];
  readonly handshakes: IncomingMessage[] = [];
  private readonly connections = new Set<{ socket: Duplex; connection: WireConnection }>();
  private server: Server | undefined;

  constructor(private readonly options: WireServerOptions) {}

  async listen(): Promise<string> {
    const server = createServer();
    server.on('upgrade', (request, socket) => this.upgrade(request, socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    return `ws://127.0.0.1:${port}/ws`;
  }

  private upgrade(request: IncomingMessage, socket: Duplex): void {
    this.handshakes.push(request);
    const key = request.headers['sec-websocket-key'];
    const cookie = request.headers.cookie;
    const origin = request.headers.origin;
    const expectedCookie =
      this.options.cookie === undefined ? undefined : `agentdev_session=${this.options.cookie}`;
    const refused =
      typeof key !== 'string' ||
      (expectedCookie !== undefined && cookie !== expectedCookie) ||
      (this.options.origin !== undefined && origin !== this.options.origin);
    if (refused) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(`${key}${GUID}`).digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );
    const connection: WireConnection = {
      request,
      send: (payload) => socket.write(frame(payload)),
      close: (code = 1000) => {
        const body = Buffer.alloc(2);
        body.writeUInt16BE(code, 0);
        socket.write(Buffer.concat([Buffer.from([0x88, body.byteLength]), body]));
        socket.end();
      },
    };
    this.connections.add({ socket, connection });
    const reader = new FrameReader();
    socket.on('data', (chunk: Buffer) => {
      for (const decoded of reader.push(chunk)) {
        if (decoded.opcode === 0x8) {
          socket.end();
          continue;
        }
        if (decoded.opcode === 0x1) this.onText(connection, decoded.text);
      }
    });
    socket.on('error', () => socket.destroy());
  }

  private onText(connection: WireConnection, text: string): void {
    this.frames.push(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const frameValue = parsed as {
      type?: unknown;
      id?: unknown;
      method?: unknown;
      params?: unknown;
      projectId?: unknown;
    };
    if (
      frameValue.type !== 'request' ||
      typeof frameValue.id !== 'string' ||
      typeof frameValue.method !== 'string'
    ) {
      return;
    }
    const message: RequestFrame = {
      id: frameValue.id,
      method: frameValue.method,
      params:
        typeof frameValue.params === 'object' && frameValue.params !== null
          ? (frameValue.params as Record<string, unknown>)
          : {},
      ...(typeof frameValue.projectId === 'string' ? { projectId: frameValue.projectId } : {}),
    };
    const reply = this.options.onRequest(message);
    if (reply === undefined) return;
    if ('error' in reply) {
      connection.send(
        JSON.stringify({
          v: 1,
          type: 'response',
          id: message.id,
          ok: false,
          error: {
            code: reply.error.code,
            message: reply.error.message,
            retryable: reply.error.retryable ?? false,
          },
        }),
      );
      return;
    }
    connection.send(
      JSON.stringify({ v: 1, type: 'response', id: message.id, ok: true, result: reply.result }),
    );
  }

  /** Pushes one event to every live connection. */
  emit(event: EventEnvelope): void {
    for (const { connection } of this.connections) connection.send(JSON.stringify(event));
  }

  closeAll(code = 1000): void {
    for (const { connection } of this.connections) connection.close(code);
  }

  /** Announces an expired session, then closes, as `protocol.md` §2 requires. */
  expire(reason = 'AUTH_EXPIRED'): void {
    for (const { connection } of this.connections) {
      connection.send(JSON.stringify({ v: 1, type: 'close', reason }));
      connection.close(1000);
    }
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    for (const { socket } of this.connections) socket.destroy();
    this.connections.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const running: WireServer[] = [];

afterEach(async () => {
  while (running.length > 0) {
    await running.pop()?.close();
  }
});

/** Waits for a real socket to make `condition` true, or fails the assertion. */
async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await flush();
    if (condition()) return;
    if (Date.now() >= deadline) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function eventOf(cursor: number, name = 'work.control_changed'): EventEnvelope {
  const uuid = `00000000-0000-7000-8000-${String(cursor).padStart(12, '0')}`;
  return {
    v: 1,
    type: 'event',
    eventId: uuid,
    projectId: PROJECT,
    cursor,
    name,
    entityId: uuid,
    entityVersion: cursor,
    data: { cursor },
  };
}

describe('WebSocketTransport on a real socket', () => {
  it('completes the handshake with Origin and cookie, then round-trips a command', async () => {
    const server = new WireServer({
      cookie: 'session-1',
      origin: 'http://127.0.0.1:4317',
      onRequest: (message) =>
        message.method === 'connection.hello'
          ? {
              result: {
                connectionId: 'connection-live',
                protocolVersion: 1,
                serverTime: '2026-01-01T00:00:00.000Z',
              },
            }
          : { result: { items: [], state: 'ok' } },
    });
    const url = await server.listen();
    running.push(server);

    const transport = new WebSocketTransport({
      url,
      headers: {
        Origin: 'http://127.0.0.1:4317',
        Cookie: 'agentdev_session=session-1',
      },
    });
    const messages: string[] = [];
    const opened = new Promise<void>((resolve, reject) => {
      transport.subscribe({
        onOpen: () => resolve(),
        onMessage: (payload) => messages.push(payload),
        onClose: (code, reason) => reject(new Error(`closed ${String(code)} ${String(reason)}`)),
        onError: (error) => reject(error),
      });
    });
    transport.open();
    await opened;
    expect(transport.state).toBe('open');
    const handshake = server.handshakes.at(-1);
    expect(handshake?.headers['origin']).toBe('http://127.0.0.1:4317');
    expect(handshake?.headers['cookie']).toBe('agentdev_session=session-1');

    transport.send(
      JSON.stringify({
        v: 1,
        type: 'request',
        id: 'client-1',
        method: 'connection.hello',
        params: { protocolVersion: 1, client: 'web' },
      }),
    );
    await waitFor(() => messages.length === 1);
    expect(messages).toHaveLength(1);
    const response = JSON.parse(messages[0] ?? '{}') as {
      ok: boolean;
      result: { connectionId: string };
    };
    expect(response.ok).toBe(true);
    expect(response.result.connectionId).toBe('connection-live');
    transport.close();
    expect(transport.state).toBe('closed');
  });

  it('delivers event frames in cursor order and parses them', async () => {
    const server = new WireServer({
      onRequest: (message) =>
        message.method === 'connection.hello'
          ? {
              result: {
                connectionId: 'c1',
                protocolVersion: 1,
                serverTime: '2026-01-01T00:00:00.000Z',
              },
            }
          : { result: { subscriptionId: 'sub-1', cursor: 0, mode: 'snapshot' } },
    });
    const url = await server.listen();
    running.push(server);
    const transport = new WebSocketTransport({ url });
    const received: EventEnvelope[] = [];
    const opened = new Promise<void>((resolve, reject) => {
      transport.subscribe({
        onOpen: () => resolve(),
        onMessage: (payload) => {
          const event = parseEventFrame(payload);
          if (event !== undefined) received.push(event);
        },
        onClose: () => undefined,
        onError: (error) => reject(error),
      });
    });
    transport.open();
    await opened;
    server.emit(eventOf(1));
    server.emit(eventOf(2, 'run.started'));
    await waitFor(() => received.length === 2);
    expect(received.map((event) => event.cursor)).toEqual([1, 2]);
    expect(received[0]?.name).toBe('work.control_changed');
    expect(received[1]?.name).toBe('run.started');
    transport.close();
    await flush();
  });

  it('refuses a wrong cookie with a 403 the client cannot confuse with success', async () => {
    const server = new WireServer({
      cookie: 'expected',
      onRequest: () => ({ result: {} }),
    });
    const url = await server.listen();
    running.push(server);
    const transport = new WebSocketTransport({
      url,
      headers: { Cookie: 'agentdev_session=wrong' },
      timers: new TestClock(),
    });
    let error: unknown;
    const settled = new Promise<void>((resolve) => {
      transport.subscribe({
        onOpen: () => resolve(),
        onMessage: () => undefined,
        onClose: () => {
          error = new Error('closed');
          resolve();
        },
        onError: (failure: ClientError) => {
          error = failure;
          resolve();
        },
      });
    });
    transport.open();
    await settled;
    await flush();
    expect(transport.state).not.toBe('open');
    expect(error).toBeInstanceOf(Error);
  });

  it('drives the full client over the real wire and resumes from a watermark', async () => {
    const events = [eventOf(1), eventOf(2, 'run.started')];
    const server = new WireServer({
      onRequest: (message) => {
        if (message.method === 'connection.hello') {
          return {
            result: {
              connectionId: 'c-live',
              protocolVersion: 1,
              serverTime: '2026-01-01T00:00:00.000Z',
            },
          };
        }
        if (message.method === 'project.subscribe') {
          const afterCursor = message.params['afterCursor'];
          const cursor = typeof afterCursor === 'number' ? afterCursor : 0;
          return {
            result: {
              subscriptionId: `sub-${String(message.id)}`,
              cursor,
              mode: typeof afterCursor === 'number' ? 'replay' : 'snapshot',
            },
          };
        }
        return { result: { acknowledged: 0 } };
      },
    });
    const url = await server.listen();
    running.push(server);
    const transport = new WebSocketTransport({ url });
    const client = new ProtocolClient({ transport });
    await client.connect();
    expect(client.state).toBe('open');
    const received: number[] = [];
    const subscription = await client.subscribe({
      projectId: PROJECT,
      scope: { kind: 'work', id: 'work-1' },
    });
    const collect = (async () => {
      for await (const event of subscription.events()) {
        received.push(event.cursor);
        if (received.length === 2) return;
      }
    })();

    expect(subscription.batch?.mode).toBe('snapshot');
    for (const event of events) server.emit(event);
    await waitFor(() => received.length === 2);
    await collect;
    expect(received).toEqual([1, 2]);
    expect(server.frames.some((frameValue) => frameValue.includes('project.subscribe'))).toBe(true);

    // A resume after the watermark asks the server for exactly the missed events.
    subscription.deliver(events[0] ?? eventOf(1));
    expect(subscription.watermark).toBe(2);
    await client.resume(subscription);
    const subscribeFrames = server.frames
      .filter((frameValue) => frameValue.includes('project.subscribe'))
      .map((frameValue) => JSON.parse(frameValue) as { params: Record<string, unknown> });
    expect(subscribeFrames.at(-1)?.params['afterCursor']).toBe(2);
    client.end();
  });

  it('ends an expired session without reconnecting', async () => {
    const server = new WireServer({
      onRequest: (message) =>
        message.method === 'connection.hello'
          ? {
              result: {
                connectionId: 'c1',
                protocolVersion: 1,
                serverTime: '2026-01-01T00:00:00.000Z',
              },
            }
          : { result: {} },
    });
    const url = await server.listen();
    running.push(server);
    const transport = new WebSocketTransport({ url, timers: new TestClock() });
    const client = new ProtocolClient({ transport, timers: new TestClock() });
    await client.connect();
    expect(client.state).toBe('open');

    // `protocol.md` §2: an expired session announces AUTH_EXPIRED and closes. The
    // client surfaces the typed failure and never reconnects with the dead cookie.
    server.expire();
    await waitFor(() => client.state === 'closed');
    await flush();
    expect(client.state).toBe('closed');
    expect(client.lastFailure?.code).toBe('AUTH_EXPIRED');
    expect(client.lastFailure?.isAuthenticationError).toBe(true);
    client.end();
  });

  it('rejects a bad url before opening anything', () => {
    const transport = new WebSocketTransport({ url: 'http://127.0.0.1:1' });
    expect(() => transport.open()).toThrow(ClientError);
  });
});
