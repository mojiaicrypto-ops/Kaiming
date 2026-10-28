/**
 * Streamable HTTP transport (MCP 2025-11-25): one endpoint, POST for messages, GET for a
 * server-to-client stream (not offered: this server pushes nothing outside a request), DELETE to end
 * a session. Authentication and Origin checks happen in the workbench's HTTP layer, which owns the
 * access password; this file only speaks protocol.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROTOCOL_VERSIONS, type JsonRpcRequest, type JsonRpcResponse, type McpProtocol } from './protocol.ts';

const BODY_LIMIT = 1024 * 1024;
const SESSION_TTL_MS = 60 * 60 * 1000;
const PROTOCOL_HEADER = 'mcp-protocol-version';
const SESSION_HEADER = 'mcp-session-id';

export interface McpHttpHandlerOptions {
  /** One protocol instance per request: the actor travels with the tools, not with the transport. */
  readonly protocolFor: (actor: string) => McpProtocol;
  readonly log?: (line: string) => void;
  readonly now?: () => number;
}

export interface McpHttpHandler {
  handle(request: IncomingMessage, response: ServerResponse, actor: string): Promise<void>;
}

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(text);
};

const rpcError = (code: number, message: string, id: string | number | null = null): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > BODY_LIMIT) throw new Error('body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createMcpHttpHandler(options: McpHttpHandlerOptions): McpHttpHandler {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, number>();

  const prune = (): void => {
    const cutoff = now() - SESSION_TTL_MS;
    for (const [id, seen] of sessions) {
      if (seen < cutoff) sessions.delete(id);
    }
  };

  return {
    async handle(request, response, actor) {
      prune();
      const method = request.method ?? 'GET';
      const version = request.headers[PROTOCOL_HEADER];
      if (typeof version === 'string' && !(PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
        json(response, 400, rpcError(-32602, `unsupported protocol version ${version}`));
        return;
      }
      const sessionId = request.headers[SESSION_HEADER];
      if (typeof sessionId === 'string') {
        if (!sessions.has(sessionId)) {
          // The spec's answer to an unknown session: 404, and the client initializes again.
          json(response, 404, rpcError(-32000, 'unknown session; initialize again'));
          return;
        }
        // Idle time, not age: a run polled for an hour must not be told its session expired.
        sessions.set(sessionId, now());
      }
      if (method === 'DELETE') {
        if (typeof sessionId === 'string') sessions.delete(sessionId);
        response.writeHead(204).end();
        return;
      }
      if (method !== 'POST') {
        // No server-initiated stream: nothing would ever be written to a GET stream here.
        response.writeHead(405, { allow: 'POST, DELETE' }).end();
        return;
      }
      let body: string;
      try {
        body = await readBody(request);
      } catch {
        json(response, 413, rpcError(-32600, 'request body is too large'));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        json(response, 400, rpcError(-32700, 'parse error'));
        return;
      }
      const protocol = options.protocolFor(actor);
      const batch = Array.isArray(parsed) ? (parsed as JsonRpcRequest[]) : null;
      const messages = batch ?? [parsed as JsonRpcRequest];
      const responses: JsonRpcResponse[] = [];
      let issued: string | null = null;
      for (const message of messages) {
        if (typeof message !== 'object' || message === null || typeof message.method !== 'string') {
          responses.push(rpcError(-32600, 'invalid request', null));
          continue;
        }
        if (message.method === 'initialize' && issued === null) {
          // The session is minted here because the client echoes the header on every later request.
          issued = randomUUID();
          sessions.set(issued, now());
        }
        const answer = await protocol.handle(message);
        if (answer !== null) responses.push(answer);
      }
      const headers: Record<string, string> = issued === null ? {} : { [SESSION_HEADER]: issued };
      if (responses.length === 0) {
        // Notifications only: accepted, nothing to say (the spec's 202).
        response.writeHead(202, headers).end();
        return;
      }
      log(`${request.method ?? 'POST'} ${responses.length === 1 ? '1 message' : `${String(responses.length)} messages`}`);
      json(response, 200, batch === null ? responses[0] : responses, headers);
    },
  };
}
