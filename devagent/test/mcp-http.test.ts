/**
 * The `/mcp` endpoint of the workbench: bearer authentication (machine callers hold no cookie), the
 * Origin check, session issuance and the transport's method rules. It speaks protocol to the same
 * router the browser uses, so `agentdev_projects` here must see the same rows.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorkbench } from '../src/server/main.ts';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const PASSWORD = 'mcp-http-secret';

async function server(): Promise<{ origin: string }> {
  const root = mkdtempSync(join(tmpdir(), 'devagent-mcp-http-'));
  const running = await startWorkbench({ dataDir: join(root, 'data'), accessPassword: PASSWORD, port: 0 });
  cleanups.push(async () => {
    await running.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { origin: running.origin };
}

const post = async (
  origin: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown>; sessionId: string | null }> => {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
    sessionId: response.headers.get('mcp-session-id'),
  };
};

describe('the /mcp endpoint', () => {
  it('refuses anonymous callers and cross-origin calls before speaking protocol', async () => {
    const { origin } = await server();
    const anonymous = await post(origin, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
    expect(anonymous.status).toBe(401);

    const wrong = await post(
      origin,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
      { authorization: 'Bearer not-the-password' },
    );
    expect(wrong.status).toBe(401);

    const crossOrigin = await post(
      origin,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
      { authorization: `Bearer ${PASSWORD}`, origin: 'http://evil.example' },
    );
    expect(crossOrigin.status).toBe(403);
  });

  it('initializes, issues a session, lists tools and serves read-only calls', async () => {
    const { origin } = await server();
    const auth = { authorization: `Bearer ${PASSWORD}` };
    const init = await post(origin, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, auth);
    expect(init.status).toBe(200);
    expect((init.json['result'] as { protocolVersion: string }).protocolVersion).toBe('2025-11-25');
    expect(init.sessionId).not.toBeNull();

    const listed = await post(origin, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, auth);
    expect((listed.json['result'] as { tools: unknown[] }).tools).toHaveLength(10);

    const projects = await post(
      origin,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'agentdev_projects', arguments: {} } },
      auth,
    );
    const result = projects.json['result'] as { isError: boolean; structuredContent: { projects?: unknown[] } };
    expect(result.isError).toBe(false);
    expect(Array.isArray(result.structuredContent.projects)).toBe(true);

    // A notification alone is accepted with 202 and no body, as the transport requires.
    const notification = await post(origin, { jsonrpc: '2.0', method: 'notifications/initialized' }, auth);
    expect(notification.status).toBe(202);
  });

  it('refuses an unknown protocol version and an unknown session, and ends a session on DELETE', async () => {
    const { origin } = await server();
    const auth = { authorization: `Bearer ${PASSWORD}` };
    const badVersion = await post(
      origin,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
      { ...auth, 'mcp-protocol-version': '1999-01-01' },
    );
    expect(badVersion.status).toBe(400);

    const init = await post(origin, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, auth);
    const sessionId = init.sessionId;
    expect(sessionId).not.toBeNull();

    const unknownSession = await post(
      origin,
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      { ...auth, 'mcp-session-id': 'not-a-session' },
    );
    expect(unknownSession.status).toBe(404);

    const ended = await fetch(`${origin}/mcp`, { method: 'DELETE', headers: { ...auth, 'mcp-session-id': sessionId ?? '' } });
    expect(ended.status).toBe(204);
    const afterEnd = await post(
      origin,
      { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
      { ...auth, 'mcp-session-id': sessionId ?? '' },
    );
    expect(afterEnd.status).toBe(404);

    // No server-initiated stream is offered, so GET is refused rather than left hanging.
    const get = await fetch(`${origin}/mcp`, { method: 'GET', headers: auth });
    expect(get.status).toBe(405);
    await get.text();
    await ended.text();
  });
});
