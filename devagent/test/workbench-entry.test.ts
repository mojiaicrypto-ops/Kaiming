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
import {
  createStubEnv,
  startStubModelServer,
  STUB_API_KEY,
  requestedModelId,
  STUB_MODEL,
  STUB_PROVIDER,
  type StubReply,
} from '../spikes/harness/pi-env.ts';
import { modelsPathFor } from '../src/runtime/provider-store.ts';

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

describe('the private path guard in a real run', () => {
  it('refuses a model read of the credential file in every path form and keeps the key out of the transcript', async () => {
    // The replies array stays ours: the tool calls can name the real credential path, which is only
    // known once the stub environment exists.
    const replies: StubReply[] = [];
    const model = await startStubModelServer(replies);
    const env = await createStubEnv(model.baseUrl);
    // Every form Pi's own tools normalize: the checks proved a guard that understood only some of
    // them let the credential through. Each read is a separate model turn.
    const credential = modelsPathFor(env.agentDir);
    const forms = [credential, `@${credential}`, `file://${credential}`, `@file://${credential}`, `@file://localhost${credential}`];
    for (const path of forms) {
      replies.push({ kind: 'tool_calls', calls: [{ name: 'read', arguments: JSON.stringify({ path }) }] });
    }
    replies.push({ kind: 'text', text: '好的。' });
    const dataDir = mkdtempSync(join(tmpdir(), 'devagent-guard-run-'));
    const running = await startWorkbench({
      dataDir,
      accessPassword: 'guard-secret',
      port: 0,
      model: { providerId: STUB_PROVIDER, modelId: STUB_MODEL },
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
      body: JSON.stringify({ method: 'auth.login', params: { password: 'guard-secret' } }),
    });
    const cookie = /agentdev_session=([0-9a-f]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const csrf = String(((await login.json()) as { result: { csrfToken: string } }).result.csrfToken);
    const call = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const response = await fetch(`${running.origin}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `agentdev_session=${cookie}`, 'x-agentdev-csrf': csrf },
        body: JSON.stringify({ requestId: `guard-${Math.random()}`, method, params }),
      });
      return (await response.json()) as Record<string, unknown>;
    };

    const opened = (await call('project.open', { path: env.cwd })) as { result: { project: { projectId: string } } };
    const projectId = opened.result.project.projectId;
    const created = (await call('session.create', { projectId })) as {
      result: { session: { sessionId: string } };
    };
    const sessionId = created.result.session.sessionId;
    await call('session.input.submit', { projectId, sessionId, content: [{ type: 'text', text: '读一下配置文件' }] });

    let messages: Array<{ role: string; content: unknown }> = [];
    for (let i = 0; i < 100; i += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      const listed = (await call('session.messages.list', { projectId, sessionId })) as {
        result: { messages: Array<{ role: string; content: unknown }> };
      };
      messages = listed.result.messages;
      if (messages.some((message) => message.role === 'assistant')) {
        break;
      }
    }



    const transcript = JSON.stringify(messages);
    // The key never appears, and every form was refused with the reason.
    expect(transcript).not.toContain(STUB_API_KEY);
    expect(transcript.match(/private storage/g) ?? []).toHaveLength(forms.length);
  }, 60_000);

  it('keeps a running input on the configuration it started with while the operator changes it', async () => {
    // The model asks the operator something, which parks the run: a deterministic window in which the
    // operator saves a different assignment.
    const replies: StubReply[] = [
      {
        kind: 'tool_calls',
        calls: [
          {
            name: 'question',
            arguments: JSON.stringify({ method: 'confirm', title: '确认一下', message: '继续吗？' }),
          },
        ],
      },
      { kind: 'text', text: '好的。' },
    ];
    const model = await startStubModelServer(replies);
    const env = await createStubEnv(model.baseUrl, { modelIds: [STUB_MODEL, 'stub-2'] });
    const dataDir = mkdtempSync(join(tmpdir(), 'devagent-active-config-'));
    const running = await startWorkbench({
      dataDir,
      accessPassword: 'active-secret',
      port: 0,
      model: { providerId: STUB_PROVIDER, modelId: STUB_MODEL },
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
      body: JSON.stringify({ method: 'auth.login', params: { password: 'active-secret' } }),
    });
    const cookie = /agentdev_session=([0-9a-f]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const csrf = String(((await login.json()) as { result: { csrfToken: string } }).result.csrfToken);
    const call = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const response = await fetch(`${running.origin}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `agentdev_session=${cookie}`, 'x-agentdev-csrf': csrf },
        body: JSON.stringify({ requestId: `active-${Math.random()}`, method, params }),
      });
      return (await response.json()) as Record<string, unknown>;
    };
    const opened = (await call('project.open', { path: env.cwd })) as { result: { project: { projectId: string } } };
    const projectId = opened.result.project.projectId;
    const created = (await call('session.create', { projectId })) as { result: { session: { sessionId: string } } };
    const sessionId = created.result.session.sessionId;
    const submitted = (await call('session.input.submit', {
      projectId,
      sessionId,
      content: [{ type: 'text', text: '问一下' }],
    })) as { result: { inputId: string } };
    const inputId = submitted.result.inputId;

    // Wait for the question to be parked, so the run really is mid-flight.
    let pending: { interactionId: string; revision: number } | undefined;
    for (let i = 0; i < 200 && pending === undefined; i += 1) {
      const prepared = (await call('session.stream.prepare', { projectId, sessionId })) as {
        result?: { snapshot?: { interactions?: Array<{ interactionId: string; revision: number }> } };
      };
      // The snapshot lists the open questions; there is one while the run is parked on it.
      const [first] = prepared.result?.snapshot?.interactions ?? [];
      pending = first === undefined ? undefined : { interactionId: first.interactionId, revision: first.revision };
      if (pending === undefined) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      }
    }
    expect(pending).toBeDefined();

    // The operator changes the configuration while the input is parked: a second model in the
    // catalog and a project assignment pointing at it.
    await call('config.save', {
      expectedRevision: null,
      value: {
        kind: 'provider',
        providerId: STUB_PROVIDER,
        baseUrl: model.baseUrl,
        api: 'openai-completions',
        apiKey: STUB_API_KEY,
        models: [
          { id: STUB_MODEL, name: STUB_MODEL },
          { id: 'stub-2', name: 'stub-2' },
        ],
      },
    });
    const assigned = (await call('config.save', {
      expectedRevision: null,
      value: { kind: 'model', providerId: STUB_PROVIDER, modelId: 'stub-2' },
      projectId,
    })) as { error?: unknown };
    expect(assigned.error).toBeUndefined();

    // Answer, let the run finish, and look at what the second model turn used.
    await call('interaction.respond', {
      projectId,
      chiefSessionId: sessionId,
      interactionId: pending?.interactionId,
      expectedRevision: pending?.revision,
      response: { confirmed: true },
    });
    let messages: Array<{ role: string }> = [];
    for (let i = 0; i < 150; i += 1) {
      const listed = (await call('session.messages.list', { projectId, sessionId })) as {
        result: { messages: Array<{ role: string }> };
      };
      messages = listed.result.messages;
      if (messages.some((message) => message.role === 'assistant')) {
        break;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    expect(messages.some((message) => message.role === 'assistant')).toBe(true);
    expect(model.requests).toHaveLength(2);
    // The active input keeps the model it started with, and so does its recorded configuration.
    expect(requestedModelId(model.requests[1])).toBe(STUB_MODEL);
    const got = (await call('session.input.get', { projectId, sessionId, inputId })) as { result: unknown };
    const recorded = (
      got.result as { input: { effectiveConfig: { modelId: string; providerId: string; source: string } } }
    ).input.effectiveConfig;
    expect(recorded.providerId).toBe(STUB_PROVIDER);
    expect(recorded.modelId).toBe(STUB_MODEL);
    // The recorded config says where it came from: the server default it started with, not the
    // project assignment saved while it ran.
    expect(recorded.source).toBe('server');
  }, 60_000);
});

describe('a chief run aborted by the watchdog', () => {
  it('is closed by the host so the session keeps working instead of freezing', async () => {
    const replies: StubReply[] = [
      { kind: 'hang' }, // the first turn never answers: the run really stalls
      { kind: 'text', text: '收到。' }, // the host's closure notice
      { kind: 'text', text: '继续。' }, // the user's next message
    ];
    const model = await startStubModelServer(replies);
    const env = await createStubEnv(model.baseUrl);
    const dataDir = mkdtempSync(join(tmpdir(), 'devagent-recover-'));
    const running = await startWorkbench({
      dataDir,
      accessPassword: 'recover-secret',
      port: 0,
      model: { providerId: STUB_PROVIDER, modelId: STUB_MODEL },
      agentDir: env.agentDir,
      runStallMs: 400,
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
      body: JSON.stringify({ method: 'auth.login', params: { password: 'recover-secret' } }),
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
        body: JSON.stringify({ requestId: `recover-${Math.random()}`, method, params }),
      });
      return (await response.json()) as Record<string, unknown>;
    };
    const inputOf = async (inputId: string): Promise<Record<string, unknown>> => {
      const read = (await call('session.input.get', { projectId, sessionId, inputId })) as {
        result: { input: Record<string, unknown> };
      };
      return read.result.input;
    };

    const opened = (await call('project.open', { path: env.cwd })) as {
      result: { project: { projectId: string } };
    };
    const projectId = opened.result.project.projectId;
    const created = (await call('session.create', { projectId })) as {
      result: { session: { sessionId: string } };
    };
    const sessionId = created.result.session.sessionId;

    const submitted = (await call('session.input.submit', {
      projectId,
      sessionId,
      content: [{ type: 'text', text: '看一下这个项目' }],
    })) as { result: { inputId: string } };
    const stalledId = submitted.result.inputId;

    // Without the host closure the row stays interrupted and every later message is refused
    // (RECOVERY_REQUIRED): the session the user saw as stuck.
    let stalled: Record<string, unknown> = {};
    for (let i = 0; i < 150; i += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      stalled = await inputOf(stalledId);
      if (stalled['status'] === 'stopped') break;
    }
    expect(stalled['status']).toBe('stopped');
    const notice = await inputOf(`notice-host-closed-${stalledId}`);
    expect(notice['kind']).toBe('system_notice');
    expect(JSON.stringify(notice['payload'])).toContain('outcome is unknown');

    // The next user message runs: the session is usable, not frozen behind recovery.
    await call('session.input.submit', { projectId, sessionId, content: [{ type: 'text', text: '继续' }] });
    let messages: Array<{ role: string }> = [];
    for (let i = 0; i < 100; i += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      const listed = (await call('session.messages.list', { projectId, sessionId })) as {
        result: { messages: Array<{ role: string }> };
      };
      messages = listed.result.messages;
      if (messages.filter((message) => message.role === 'assistant').length >= 2) break;
    }
    expect(messages.filter((message) => message.role === 'assistant').length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
