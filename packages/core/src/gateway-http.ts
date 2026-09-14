/**
 * The Core-side model gateway endpoint a Runner calls (WP-11 A2-T6).
 *
 * `docs/architecture/execution.md` §2: "Runner内Pi通过OpenAI-compatible Model Gateway或
 * 对应Provider适配器调用模型。Gateway在Core受信侧持有Provider Secret，Runner只持有短期
 * attempt capability". The Runner's Pi session is pointed at this loopback server through a
 * per-Attempt `models.json`, so:
 *
 * - the Provider secret never leaves the Core process;
 * - the *frozen* Run configuration decides provider and model — the Runner cannot ask for
 *   another model (a mismatching `model` field is refused rather than substituted);
 * - expiry, epoch and role are checked per request, and usage is reported back so the
 *   budget layer can reconcile it (`reliability.md` §3).
 *
 * The endpoint speaks the small OpenAI-compatible subset the Pi SDK uses:
 * `POST /chat/completions` (JSON or SSE) and `GET /models`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { JsonValue, RuntimeHost } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';

import type { AttemptCapabilityStore } from './capabilities.js';
import type { GatewayToolCall, ModelGateway } from './model-gateway.js';

/** Minimal message shape the proxy accepts from a Runner (including tool round-trips). */
export interface ProxyMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** Assistant messages that asked for tools. */
  readonly toolCalls?: readonly GatewayToolCall[];
  /** `tool` messages: the call they answer. */
  readonly toolCallId?: string;
}

export interface ModelGatewayProxyOptions {
  readonly gateway: ModelGateway;
  readonly store: ProjectStore;
  readonly capabilities: AttemptCapabilityStore;
  readonly host?: RuntimeHost;
  /** 0 asks the OS for a free port (tests use this). */
  readonly port?: number;
  readonly maxBodyBytes?: number;
  /**
   * Called before the completion, so the daemon can authorize the secret access of
   * *this* Run (the Gateway resolves the Provider credential itself).
   */
  readonly authorize?: (input: {
    readonly run: {
      readonly id: string;
      readonly workId: string;
      readonly role: string;
      readonly stage: string;
      readonly purpose: string;
    };
    readonly attemptId: string;
  }) => void;
  /** Called after a successful completion so the daemon can reconcile the budget. */
  readonly onUsage?: (usage: {
    readonly runId: string;
    readonly attemptId: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
  }) => void;
  readonly log?: (line: string) => void;
}

export interface ModelGatewayProxy {
  readonly server: Server;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = `${JSON.stringify(body)}\n`;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(text);
}

/** OpenAI-shaped error body, with the product's own code preserved. */
function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { error: { code, message, type: code } });
}

/** Every refusal is logged: a refused Runner call must never look like a quiet success. */
function refuse(
  response: ServerResponse,
  log: (line: string) => void,
  status: number,
  code: string,
  message: string,
): void {
  log(`gateway-proxy: refused ${String(status)} ${code}: ${message}`);
  sendError(response, status, code, message);
}

async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    if (bytes > limit) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function statusFor(code: string): number {
  switch (code) {
    case 'CONFIG_INVALID':
    case 'VALIDATION_ERROR':
      return 400;
    case 'NOT_AUTHORIZED':
    case 'UNAUTHENTICATED':
      return 401;
    case 'AUTH_EXPIRED':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'VERSION_CONFLICT':
    case 'INVALID_STATE':
      return 409;
    case 'PROVIDER_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}

/**
 * Flattens one message's content.
 *
 * The Pi SDK sends the modern multimodal shape (`content: [{type:'text',text:'…'}]`) even
 * for pure text, so a proxy that only accepted a bare string would refuse every real call
 * (found by the WP-11 real-Attempt drill).
 */
function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part);
      continue;
    }
    if (part === null || typeof part !== 'object') return null;
    const text = (part as { text?: unknown }).text;
    if (typeof text === 'string') parts.push(text);
  }
  return parts.join('');
}

/**
 * Parses the OpenAI `messages` array; unknown fields are ignored like the SDK's peers.
 *
 * `tool` messages and assistant `tool_calls` are part of the round trip a tool-using model
 * needs (WP-12 R3-1): the second call carries the result of the first.
 */
function parseMessages(value: unknown): ProxyMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: ProxyMessage[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') return null;
    const role = (entry as { role?: unknown }).role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') {
      return null;
    }
    const toolCalls = toolCallsOf((entry as { tool_calls?: unknown }).tool_calls);
    const toolCallId = (entry as { tool_call_id?: unknown }).tool_call_id;
    // An assistant message that only asked for tools has `content: null` in the
    // OpenAI-compatible shape; its text is empty, not malformed (WP-12 R3-1).
    const content =
      textOf((entry as { content?: unknown }).content) ??
      (role === 'assistant' && toolCalls.length > 0 ? '' : null);
    if (content === null) return null;
    if (role === 'tool' && typeof toolCallId !== 'string') return null;
    messages.push({
      role,
      content,
      ...(toolCalls.length === 0 ? {} : { toolCalls }),
      ...(typeof toolCallId === 'string' ? { toolCallId } : {}),
    });
  }
  return messages.length === 0 ? null : messages;
}

/** Normalises the OpenAI `tool_calls` member of an inbound assistant message. */
function toolCallsOf(value: unknown): GatewayToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: GatewayToolCall[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const fn = (record['function'] ?? {}) as Record<string, unknown>;
    const name = fn['name'];
    if (typeof name !== 'string' || name.length === 0) continue;
    const id = record['id'];
    const args = fn['arguments'];
    calls.push({
      id: typeof id === 'string' && id.length > 0 ? id : `call_${String(calls.length)}`,
      type: 'function',
      function: { name, arguments: typeof args === 'string' ? args : '' },
    });
  }
  return calls;
}

/**
 * Starts the proxy. The caller owns the returned object (`close()` on shutdown).
 */
export async function createModelGatewayProxy(
  options: ModelGatewayProxyOptions,
): Promise<ModelGatewayProxy> {
  const host = options.host ?? '127.0.0.1';
  const maxBodyBytes = options.maxBodyBytes ?? 4 * 1024 * 1024;
  const log = options.log ?? (() => undefined);

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      log(`gateway-proxy: ${error instanceof Error ? error.message : String(error)}`);
      sendError(response, 500, 'INTERNAL_ERROR', 'the gateway proxy failed');
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, { ok: true });
      return;
    }

    const authorization = request.headers.authorization ?? '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;
    const verdict = options.capabilities.verify(token);
    if (!verdict.ok) {
      refuse(response, log, statusFor(verdict.code), verdict.code, verdict.message);
      return;
    }
    const capability = verdict.capability;
    const run = options.store.runs.find(capability.runId);
    if (run === undefined) {
      refuse(response, log, 404, 'NOT_FOUND', `Run ${capability.runId} does not exist`);
      return;
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      // A capability never outlives its Run: a terminal Run refuses further calls.
      options.capabilities.revoke(capability.attemptId);
      refuse(response, log, 409, 'INVALID_STATE', `Run ${run.id} is ${run.status}`);
      return;
    }
    // The capability is re-checked against the *current* Attempt on every call
    // (`execution.md` §2: capability binding is attempt/epoch/role/expiry). A parked or
    // finished Attempt must not keep calling, whatever token an old process still holds.
    const attempt = options.store.attempts.find(capability.attemptId);
    if (attempt === undefined) {
      options.capabilities.revoke(capability.attemptId);
      refuse(
        response,
        log,
        401,
        'NOT_AUTHORIZED',
        `Attempt ${capability.attemptId} does not exist`,
      );
      return;
    }
    if (attempt.status !== 'starting' && attempt.status !== 'running') {
      options.capabilities.revoke(capability.attemptId);
      refuse(
        response,
        log,
        401,
        'NOT_AUTHORIZED',
        `Attempt ${capability.attemptId} is ${attempt.status}; its capability is no longer valid`,
      );
      return;
    }
    if (attempt.ownerEpoch + 1 !== capability.epoch) {
      options.capabilities.revoke(capability.attemptId);
      refuse(
        response,
        log,
        401,
        'NOT_AUTHORIZED',
        `the capability epoch ${String(capability.epoch)} does not match Attempt ${capability.attemptId} (${String(attempt.ownerEpoch + 1)})`,
      );
      return;
    }

    if (request.method === 'GET' && url.pathname === '/models') {
      // The SDK asks for the catalog when a provider is registered; answer with the
      // frozen model so no discovery can substitute a different one.
      const frozen = options.gateway.frozenFor(run);
      sendJson(response, 200, {
        object: 'list',
        data:
          frozen === undefined
            ? []
            : [
                {
                  id: frozen.model.id,
                  object: 'model',
                  owned_by: frozen.provider.providerId,
                  // The SDK reads these for capability decisions.
                  context_window: frozen.model.contextWindow,
                  max_output_tokens: frozen.model.maxOutputTokens,
                },
              ],
      });
      return;
    }

    if (request.method !== 'POST' || url.pathname !== '/chat/completions') {
      refuse(response, log, 404, 'NOT_FOUND', url.pathname);
      return;
    }

    let body: { messages?: unknown; model?: unknown; stream?: unknown; tools?: unknown };
    try {
      body = JSON.parse(await readBody(request, maxBodyBytes)) as typeof body;
    } catch (error) {
      refuse(
        response,
        log,
        400,
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'bad body',
      );
      return;
    }
    const messages = parseMessages(body.messages);
    if (messages === null) {
      refuse(
        response,
        log,
        400,
        'VALIDATION_ERROR',
        'messages must be a non-empty role/content array',
      );
      return;
    }
    const frozen = options.gateway.frozenFor(run);
    if (frozen === undefined) {
      refuse(response, log, 409, 'STALE_ARTIFACT', `config snapshot for Run ${run.id} is missing`);
      return;
    }
    if (typeof body.model === 'string' && body.model !== frozen.model.id) {
      // `execution.md` §2: a Run's model comes from its frozen configuration. Asking for
      // another one is refused, never silently substituted.
      refuse(
        response,
        log,
        409,
        'CONFIG_INVALID',
        `Run ${run.id} is frozen to model ${frozen.model.id}; ${body.model} was requested`,
      );
      return;
    }

    try {
      options.authorize?.({ run, attemptId: capability.attemptId });
    } catch (error) {
      refuse(
        response,
        log,
        403,
        'NOT_AUTHORIZED',
        error instanceof Error ? error.message : 'the Run may not use this Provider',
      );
      return;
    }
    // The request-side tool schemas are forwarded as-is: R3-1 taught the proxy to return
    // `tool_calls`, but a Provider that never received `tools` cannot produce any
    // (WP-12 R3-2c). An unexpected shape is refused rather than silently dropped.
    let tools: readonly JsonValue[] | undefined;
    if (body.tools !== undefined) {
      if (!Array.isArray(body.tools)) {
        refuse(response, log, 400, 'VALIDATION_ERROR', 'tools must be an array');
        return;
      }
      tools = body.tools as readonly JsonValue[];
    }
    const completion = await options.gateway.complete(run, messages, tools);
    if (!completion.ok) {
      refuse(response, log, statusFor(completion.code), completion.code, completion.message);
      return;
    }
    try {
      options.onUsage?.({
        runId: run.id,
        attemptId: capability.attemptId,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      });
    } catch (error) {
      // Accounting is booked at settlement; a refusal here must not turn a real answer
      // into a failed call (the SDK would retry and the Provider would be paid twice).
      log(
        `gateway-proxy: usage was not recorded for ${run.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const created = Math.floor(Date.now() / 1000);
    log(
      `gateway-proxy: ${run.id} attempt ${capability.attemptId} ${body.stream === true ? 'stream' : 'json'} ${frozen.model.id} → ${String(completion.text.length)} chars${
        completion.toolCalls === undefined
          ? ''
          : `, ${String(completion.toolCalls.length)} tool call(s)`
      }`,
    );
    if (body.stream === true) {
      // One SSE chunk carrying the whole answer, then the terminator: the SDK's stream
      // reader gets a valid event sequence without the proxy having to fake partial
      // tokens (the product's Gateway is a single-shot completion).
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const chunk = {
        id: `chatcmpl-${run.id}`,
        object: 'chat.completion.chunk',
        created,
        model: frozen.model.id,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: completion.text,
              ...(completion.toolCalls === undefined
                ? {}
                : {
                    // One delta per call carrying the complete arguments: the SDK concatenates
                    // by `index`, so a single delta is a valid stream (WP-12 R3-1).
                    tool_calls: completion.toolCalls.map((call, index) => ({
                      index,
                      id: call.id,
                      type: call.type,
                      function: {
                        name: call.function.name,
                        arguments: call.function.arguments,
                      },
                    })),
                  }),
            },
            finish_reason: null,
          },
        ],
      };
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.write(
        `data: ${JSON.stringify({
          ...chunk,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason:
                completion.toolCalls === undefined || completion.toolCalls.length === 0
                  ? 'stop'
                  : 'tool_calls',
            },
          ],
        })}\n\n`,
      );
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }
    sendJson(response, 200, {
      id: `chatcmpl-${run.id}`,
      object: 'chat.completion',
      created,
      model: frozen.model.id,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: completion.text,
            ...(completion.toolCalls === undefined
              ? {}
              : {
                  tool_calls: completion.toolCalls.map((call) => ({
                    id: call.id,
                    type: call.type,
                    function: {
                      name: call.function.name,
                      arguments: call.function.arguments,
                    },
                  })),
                }),
          },
          // A completion that only asked for tools ends the turn with `tool_calls`, exactly
          // as the OpenAI-compatible API does.
          finish_reason:
            completion.toolCalls === undefined || completion.toolCalls.length === 0
              ? 'stop'
              : 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: completion.inputTokens,
        completion_tokens: completion.outputTokens,
        total_tokens: completion.inputTokens + completion.outputTokens,
      },
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;
  return {
    server,
    port,
    url: `http://${host}:${String(port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
