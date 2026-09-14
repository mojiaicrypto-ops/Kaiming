/**
 * The production OpenAI-compatible Provider transport (WP-11 A2-T6).
 *
 * `docs/architecture/execution.md` §2: "Runner内Pi通过OpenAI-compatible Model Gateway或
 * 对应Provider适配器调用模型。Gateway在Core受信侧持有Provider Secret". The Core's
 * `ModelGateway` needs a transport to reach the user's endpoint, and until now the only one
 * in the repository lived inside the release drill (`scripts/lib/live-transport.mjs`). This
 * is the product's own implementation, built on Node's `node:http`/`node:https` so no
 * dependency is added:
 *
 * - the credential is sent as `Authorization: Bearer …` and is masked in every failure
 *   message this module produces;
 * - a reasoning model that spends its budget thinking (empty `content`, non-empty
 *   `reasoning_content`) still yields text, so a working endpoint is not reported broken;
 * - failures map onto the Gateway's error vocabulary (`PROVIDER_UNAVAILABLE` retryable for
 *   429/5xx and transport errors, `CONFIG_INVALID` otherwise), and only those map to a
 *   retry (`reliability.md` §6: 2s/8s for transient errors only).
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import type {
  GatewayRequest,
  GatewayResponse,
  GatewayToolCall,
  GatewayTransport,
} from './model-gateway.js';

/** Declared per-call timeout; a hung endpoint must not hold a Runner forever. */
export const PROVIDER_TIMEOUT_MS = 300_000;

export interface OpenAiTransportOptions {
  readonly timeoutMs?: number;
  /** Per-call hook for diagnostics; never receives the credential. */
  readonly onCall?: (call: {
    readonly providerId: string;
    readonly modelId: string;
    readonly status: number | null;
    readonly ok: boolean;
    readonly latencyMs: number;
    readonly error?: string;
  }) => void;
}

/** Replaces the credential with a fixed marker in any diagnostic text. */
export function maskSecret(text: string, secret: string | undefined): string {
  if (secret === undefined || secret.length === 0) return text;
  return text.split(secret).join('<redacted>');
}

/** Appends `/chat/completions` unless the configured base already names it. */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

/**
 * Extracts the assistant text of an OpenAI-compatible body.
 *
 * `content` wins; a reasoning model's `reasoning_content`/`reasoning` is the fallback
 * (WP-10 review found the drill failing on exactly that shape).
 */
/**
 * The tool calls of one completion body (`choices[0].message.tool_calls`).
 *
 * A model that only asks for tools has no text at all, so this is what makes such a
 * completion a *success* rather than "no completion text" (WP-12 R3-1).
 */
export function extractToolCalls(payload: unknown): GatewayToolCall[] {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const message = (choices[0] as { message?: Record<string, unknown> })?.message;
  const calls = message?.['tool_calls'];
  if (!Array.isArray(calls)) return [];
  return calls.map((call, index) => {
    const record = (call ?? {}) as Record<string, unknown>;
    const fn = (record['function'] ?? {}) as Record<string, unknown>;
    return {
      id:
        typeof record['id'] === 'string' && record['id'].length > 0
          ? record['id']
          : `call_${String(index)}`,
      type: 'function' as const,
      function: {
        name: typeof fn['name'] === 'string' ? fn['name'] : '',
        arguments: typeof fn['arguments'] === 'string' ? fn['arguments'] : '',
      },
    };
  });
}

export function extractCompletionText(payload: unknown): string | null {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: Record<string, unknown> })?.message;
  if (message === undefined) return null;
  const content = message['content'];
  if (typeof content === 'string' && content.length > 0) return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((part) =>
        typeof part === 'string'
          ? part
          : typeof (part as { text?: unknown })?.text === 'string'
            ? (part as { text: string }).text
            : '',
      )
      .filter((part) => part.length > 0);
    if (parts.length > 0) return parts.join('');
  }
  for (const key of ['reasoning_content', 'reasoning']) {
    const reasoning = message[key];
    if (typeof reasoning === 'string' && reasoning.trim().length > 0) return reasoning;
  }
  return typeof content === 'string' ? content : null;
}

function usageOf(payload: unknown): { inputTokens: number; outputTokens: number } {
  const usage = (payload as { usage?: Record<string, unknown> })?.usage ?? {};
  const input = Number(usage['prompt_tokens'] ?? usage['input_tokens'] ?? 0);
  const output = Number(usage['completion_tokens'] ?? usage['output_tokens'] ?? 0);
  return {
    inputTokens: Number.isFinite(input) && input > 0 ? input : 0,
    outputTokens: Number.isFinite(output) && output > 0 ? output : 0,
  };
}

function excerpt(text: string, limit = 300): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}

/** One real HTTP round trip against an OpenAI-compatible endpoint. */
export class OpenAiCompatibleTransport implements GatewayTransport {
  private readonly timeoutMs: number;
  private readonly onCall: OpenAiTransportOptions['onCall'];

  constructor(options: OpenAiTransportOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
    this.onCall = options.onCall;
  }

  async complete(request: GatewayRequest): Promise<GatewayResponse> {
    const startedAt = Date.now();
    const apiKey = request.apiKey;
    const url = new URL(chatCompletionsUrl(request.baseUrl));
    const body = JSON.stringify({
      model: request.modelId,
      // A `tool` result and an assistant `tool_calls` message must round-trip: the Provider
      // needs the call id to connect them (WP-12 R3-1).
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.toolCalls === undefined
          ? {}
          : {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: call.type,
                function: { name: call.function.name, arguments: call.function.arguments },
              })),
            }),
        ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
      })),
      max_tokens: request.maxOutputTokens,
      // The tool schemas the session offered travel to the Provider unchanged; without them
      // a real model can never answer with a tool call (WP-12 R3-2c).
      ...(request.tools === undefined ? {} : { tools: request.tools }),
      stream: false,
    });
    const finish = (status: number | null, ok: boolean, error?: string): void => {
      this.onCall?.({
        providerId: request.providerId,
        modelId: request.modelId,
        status,
        ok,
        latencyMs: Date.now() - startedAt,
        ...(error === undefined ? {} : { error }),
      });
    };

    let status: number;
    let text: string;
    try {
      const response = await this.send(url, body, apiKey);
      status = response.status;
      text = response.text;
    } catch (error) {
      const message = maskSecret(error instanceof Error ? error.message : String(error), apiKey);
      finish(null, false, message);
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        retryable: true,
        message: `the Provider could not be reached: ${message}`,
      };
    }

    if (status < 200 || status >= 300) {
      const retryable = status === 429 || status >= 500;
      const detail = maskSecret(excerpt(text), apiKey);
      finish(status, false, `HTTP ${String(status)}`);
      return {
        ok: false,
        code: status === 401 || status === 403 ? 'CONFIG_INVALID' : 'PROVIDER_UNAVAILABLE',
        retryable,
        message: `the Provider answered HTTP ${String(status)}: ${detail}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      finish(status, false, 'non-JSON body');
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        retryable: false,
        message: 'the Provider returned a non-JSON body',
      };
    }
    const toolCalls = extractToolCalls(parsed);
    const completion = extractCompletionText(parsed);
    if ((completion === null || completion.trim().length === 0) && toolCalls.length === 0) {
      finish(status, false, 'no completion text');
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        retryable: false,
        message: 'the Provider returned no completion text',
      };
    }
    const usage = usageOf(parsed);
    finish(status, true);
    return {
      ok: true,
      text: completion ?? '',
      ...(toolCalls.length === 0 ? {} : { toolCalls }),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  }

  private send(
    url: URL,
    body: string,
    apiKey: string | undefined,
  ): Promise<{ status: number; text: string }> {
    const isHttps = url.protocol === 'https:';
    const send = isHttps ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
          },
          timeout: this.timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              text: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('timeout', () =>
        req.destroy(new Error(`the Provider did not answer within ${String(this.timeoutMs)}ms`)),
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
