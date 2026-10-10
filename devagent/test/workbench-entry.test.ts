/**
 * The composition root itself (R1/M4): `startWorkbench` is what the operator runs, and its wiring is
 * what a page depends on. A silent gap here - a runner that runs but never publishes, a stream that
 * never carries an event - is invisible to every test that assembles its own stack, so this one uses
 * the entry point verbatim and asserts that a real run really reaches a reader.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorkbench } from '../src/server/main.ts';
import { createStubEnv, startStubModelServer } from '../spikes/harness/pi-env.ts';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe('workbench entry point', () => {
  it('publishes a real run to a prepared reader', async () => {
    const model = await startStubModelServer([{ kind: 'text', text: '收到。' }]);
    const env = await createStubEnv(model.baseUrl);
    const dataDir = mkdtempSync(join(tmpdir(), 'devagent-entry-'));
    const running = await startWorkbench({
      dataDir,
      accessPassword: 'entry-secret',
      port: 0,
      model: { providerId: 'stub', modelId: 'stub-1' },
      agentDir: env.agentDir,
    });
    cleanups.push(async () => {
      await running.close();
      await model.close();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(env.root, { recursive: true, force: true });
    });

    const login = await fetch(`${running.origin}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'auth.login', params: { password: 'entry-secret' } }),
    });
    const cookie = /agentdev_session=([0-9a-f]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const csrf = String(((await login.json()) as { result: { csrfToken: string } }).result.csrfToken);
    const call = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const response = await fetch(`${running.origin}/api/v1/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `agentdev_session=${cookie}`,
          'x-agentdev-csrf': csrf,
        },
        body: JSON.stringify({ requestId: `entry-${Math.random()}`, method, params }),
      });
      return (await response.json()) as Record<string, unknown>;
    };

    const opened = (await call('project.open', { path: env.cwd })) as {
      result: { project: { projectId: string } };
    };
    const projectId = opened.result.project.projectId;
    const created = (await call('session.create', { projectId })) as {
      result: { session: { sessionId: string } };
    };
    const sessionId = created.result.session.sessionId;
    const prepared = (await call('session.stream.prepare', { projectId, sessionId })) as {
      result: { streamPath: string };
    };

    // Read the stream the way a browser does, then let a real run happen.
    const streamUrl = `${running.origin}${prepared.result.streamPath}`;
    const frames: string[] = [];
    const response = await fetch(streamUrl, {
      headers: { accept: 'text/event-stream', cookie: `agentdev_session=${cookie}` },
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    const pump = (async () => {
      let buffered = '';
      for (;;) {
        const chunk = await reader?.read();
        if (chunk === undefined || chunk.done === true) {
          return;
        }
        buffered += decoder.decode(chunk.value, { stream: true });
        let boundary = buffered.indexOf('\n\n');
        while (boundary >= 0) {
          frames.push(buffered.slice(0, boundary));
          buffered = buffered.slice(boundary + 2);
          boundary = buffered.indexOf('\n\n');
        }
      }
    })();

    await call('session.input.submit', { projectId, sessionId, content: [{ type: 'text', text: '收到。' }] });
    for (let i = 0; i < 100 && !frames.some((frame) => frame.includes('message_end')); i += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    await reader?.cancel();
    await pump;

    // The run really happened (the input settled), and its events really reached the reader.
    expect(frames.some((frame) => frame.includes('agent_start'))).toBe(true);
    expect(frames.some((frame) => frame.includes('message_end'))).toBe(true);
    const listed = (await call('session.messages.list', { projectId, sessionId })) as {
      result: { messages: Array<{ role: string }> };
    };
    expect(listed.result.messages.some((message) => message.role === 'assistant')).toBe(true);
  }, 60_000);
});
