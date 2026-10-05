/**
 * P0 harness: temp agent dir + local OpenAI-compatible stub provider + session factory.
 *
 * Evidence boundary: exercises the real Pi SDK (session lifecycle, extensions, JSONL
 * persistence, abort, multi-session) against a *stub* model endpoint. It proves SDK
 * plumbing, not real model behaviour (that is I4 / P6, requires real credentials).
 *
 * No process-global state is required or switched: every session gets its own cwd, agentDir,
 * sessionDir and ModelRuntime, and the harness never changes process.cwd() or process.env
 * (both asserted in pi-07).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type InlineExtension,
  type PromptTemplate,
  type SessionEntry,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';

export const STUB_PROVIDER = 'stub';
export const STUB_MODEL = 'stub-1';
export const STUB_API_KEY = 'stub-key';

/** Input-correlation bookmark customType (R4 `agentdev.input-marker`): bookkeeping only. */
export const INPUT_MARKER_CUSTOM_TYPE = 'agentdev.input-marker';
/** Recovery/control notice customType (R4/M3 `agentdev.input-notice`): enters model context. */
export const NOTICE_CUSTOM_TYPE = 'agentdev.input-notice';

export interface InputMarker {
  readonly inputId: string;
  readonly requestDigest: string;
  readonly generation: { readonly serverEpoch: number; readonly claim: number };
}

export type StubReply =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tool_calls'; readonly calls: ReadonlyArray<{ name: string; arguments: string }> }
  | { readonly kind: 'http_error'; readonly status: number; readonly message?: string };

export interface StubRequest {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface StubServer {
  readonly baseUrl: string;
  readonly requests: StubRequest[];
  readonly port: number;
  close(): Promise<void>;
}

interface ChatChunkDelta {
  readonly [key: string]: unknown;
}

function sseChunk(modelId: string, delta: ChatChunkDelta, finishReason: string | null): string {
  const payload = {
    id: 'chatcmpl-stub',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const STUB_USAGE = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

function writeCompletion(res: ServerResponse, reply: StubReply): void {
  if (reply.kind === 'http_error') {
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: reply.message ?? `stub ${reply.status}`,
          type: 'stub_error',
          code: `stub_${reply.status}`,
        },
      }),
    );
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(sseChunk(STUB_MODEL, { role: 'assistant', content: '' }, null));
  if (reply.kind === 'text') {
    res.write(sseChunk(STUB_MODEL, { content: reply.text }, null));
    res.write(
      sseChunk(STUB_MODEL, {}, 'stop').replace('}}', `},"usage":${JSON.stringify(STUB_USAGE)}}`),
    );
  } else {
    reply.calls.forEach((call, index) => {
      res.write(
        sseChunk(
          STUB_MODEL,
          {
            tool_calls: [
              {
                index,
                id: `call_${index}`,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              },
            ],
          },
          null,
        ),
      );
    });
    res.write(
      sseChunk(STUB_MODEL, {}, 'tool_calls').replace(
        '}}',
        `},"usage":${JSON.stringify(STUB_USAGE)}}`,
      ),
    );
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * Start a scripted OpenAI Chat Completions endpoint. Reply i answers request i; the last
 * reply repeats for any further request.
 */
export async function startStubModelServer(replies: readonly StubReply[]): Promise<StubServer> {
  const requests: StubRequest[] = [];
  let served = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try {
        body = raw === '' ? undefined : JSON.parse(raw);
      } catch {
        body = raw;
      }
      const path = req.url ?? '';
      requests.push({ path, authorization: req.headers.authorization, body });
      if (path.startsWith('/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [{ id: STUB_MODEL, object: 'model', owned_by: STUB_PROVIDER }],
          }),
        );
        return;
      }
      const reply =
        replies[Math.min(served, replies.length - 1)] ?? ({ kind: 'text', text: 'ok' } as const);
      served += 1;
      writeCompletion(res, reply);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('stub server failed to bind');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    port: address.port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export interface StubEnv {
  readonly root: string;
  readonly cwd: string;
  readonly agentDir: string;
  readonly sessionDir: string;
  readonly modelsPath: string;
  readonly authPath: string;
  cleanup(): Promise<void>;
}

export async function createStubEnv(
  baseUrl: string | undefined,
  options: {
    readonly modelIds?: readonly string[];
    readonly deadProviderBaseUrl?: string;
    /** When given, these providers are written verbatim and no stub provider is added. */
    readonly providers?: Record<string, unknown>;
  } = {},
): Promise<StubEnv> {
  const root = await mkdtemp(join(tmpdir(), 'devagent-p0-'));
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  const sessionDir = join(root, 'sessions');
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
  ]);
  const modelsPath = join(agentDir, 'models.json');
  const authPath = join(agentDir, 'auth.json');
  const modelIds = options.modelIds ?? [STUB_MODEL];
  const providers =
    options.providers ??
    ({
      [STUB_PROVIDER]: {
        baseUrl,
        api: 'openai-completions',
        apiKey: STUB_API_KEY,
        models: modelIds.map((id) => ({ id, name: id })),
      },
      ...(options.deadProviderBaseUrl
        ? {
            dead: {
              baseUrl: options.deadProviderBaseUrl,
              api: 'openai-completions',
              apiKey: 'dead-key',
              models: [{ id: 'dead-1', name: 'dead-1' }],
            },
          }
        : {}),
    } satisfies Record<string, unknown>);
  await writeFile(modelsPath, JSON.stringify({ providers }, null, 2));
  await writeFile(authPath, '[]');
  return {
    root,
    cwd,
    agentDir,
    sessionDir,
    modelsPath,
    authPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export interface OpenSessionOptions {
  readonly tools?: string[];
  readonly customTools?: ToolDefinition[];
  readonly extensionFactories?: InlineExtension[];
  readonly sessionManager?: SessionManager;
  readonly noTools?: 'all' | 'builtin';
  readonly modelId?: string;
  readonly providerId?: string;
  readonly promptTemplates?: PromptTemplate[];
}

export interface OpenedSession {
  readonly session: AgentSession;
  readonly sessionManager: SessionManager;
  readonly modelRuntime: ModelRuntime;
  readonly resourceLoader: DefaultResourceLoader;
}

/** Create one Pi session bound to the given env, with no global cwd/env mutation. */
export async function openSession(
  env: StubEnv,
  options: OpenSessionOptions = {},
): Promise<OpenedSession> {
  const modelRuntime = await ModelRuntime.create({
    modelsPath: env.modelsPath,
    authPath: env.authPath,
    allowModelNetwork: false,
  });
  const model = modelRuntime.getModel(
    options.providerId ?? STUB_PROVIDER,
    options.modelId ?? STUB_MODEL,
  );
  if (!model) {
    throw new Error(
      `model ${options.providerId ?? STUB_PROVIDER}/${options.modelId ?? STUB_MODEL} is not registered`,
    );
  }
  const promptTemplates = options.promptTemplates;
  const resourceLoader = new DefaultResourceLoader({
    cwd: env.cwd,
    agentDir: env.agentDir,
    extensionFactories: options.extensionFactories ?? [],
    ...(promptTemplates
      ? {
          promptsOverride: (current) => ({
            prompts: [...current.prompts, ...promptTemplates],
            diagnostics: current.diagnostics,
          }),
        }
      : {}),
  });
  await resourceLoader.reload();
  const sessionManager = options.sessionManager ?? SessionManager.create(env.cwd, env.sessionDir);
  const { session } = await createAgentSession({
    cwd: env.cwd,
    agentDir: env.agentDir,
    modelRuntime,
    model,
    resourceLoader,
    sessionManager,
    thinkingLevel: 'off',
    ...(options.customTools ? { customTools: options.customTools } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.noTools ? { noTools: options.noTools } : {}),
  });
  return { session, sessionManager, modelRuntime, resourceLoader };
}

/** All entries reachable from rootId (excluding rootId itself), depth-first. */
export function descendantsOf(entries: readonly SessionEntry[], rootId: string): SessionEntry[] {
  const out: SessionEntry[] = [];
  const visit = (parentId: string): void => {
    for (const entry of entries) {
      if (entry.parentId === parentId) {
        out.push(entry);
        visit(entry.id);
      }
    }
  };
  visit(rootId);
  return out;
}

export function findMarker(
  entries: readonly SessionEntry[],
  inputId: string,
): SessionEntry | undefined {
  return entries.find(
    (entry) =>
      entry.type === 'custom' &&
      entry.customType === INPUT_MARKER_CUSTOM_TYPE &&
      (entry.data as InputMarker | undefined)?.inputId === inputId,
  );
}

/** Model id actually requested by Pi, read with runtime narrowing (no unchecked cast). */
export function requestedModelId(request: StubRequest | undefined): string {
  const body = request?.body;
  if (body !== null && typeof body === 'object' && 'model' in body) {
    const model = body.model;
    return typeof model === 'string' ? model : 'non-string';
  }
  return 'none';
}

export interface CheckResult {
  readonly check: string;
  readonly ok: boolean;
  readonly detail: string;
}

export function createChecker(): {
  check(name: string, ok: boolean, detail: string): void;
  finish(exitCodeOnFailure?: number): void;
  readonly results: CheckResult[];
} {
  const results: CheckResult[] = [];
  return {
    results,
    check(name, ok, detail) {
      results.push({ check: name, ok, detail });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
    },
    finish(exitCodeOnFailure = 1) {
      const failed = results.filter((result) => !result.ok);
      console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
      if (failed.length > 0) {
        process.exitCode = exitCodeOnFailure;
      }
    },
  };
}