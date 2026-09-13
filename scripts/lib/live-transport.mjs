/**
 * The real Provider transport and its configuration gate (WP-10 T3).
 *
 * `packages/core/src/model-gateway.ts` deliberately injects its transport ("the real
 * HTTP clients land in WP-10 with the Provider vertical run"), so this module is the
 * OpenAI-compatible client `pnpm test:live` runs against the endpoint the user
 * configured in the environment:
 *
 * - {@link readProviderEnvironment} is a pure read of the three documented variables.
 *   It never guesses a default endpoint: a missing input is reported as missing, which
 *   is what keeps `test:live` from silently calling a network location nobody
 *   configured.
 * - {@link createOpenAiCompatibleTransport} is a real `node:https`/`node:http` client
 *   implementing the Gateway's `GatewayTransport` contract. It records every call
 *   (URL, status, latency, byte counts) so the drill can publish raw evidence, and it
 *   masks the credential in every recorded failure.
 *
 * Nothing here fakes a completion: an unreachable, refusing or unparseable Provider
 * becomes `ok: false` with a real code and the raw (redacted) response excerpt.
 */
import { request as httpRequestBase } from 'node:http';
import { request as httpsRequestBase } from 'node:https';

/** The three variables the release command requires (`implementation.md` §3). */
export const PROVIDER_ENV = Object.freeze({
  baseUrl: 'AGENTDEV_PROVIDER_BASE_URL',
  model: 'AGENTDEV_PROVIDER_MODEL',
  secret: 'AGENTDEV_PROVIDER_SECRET',
});

/** Optional knobs the runner documents but never requires. */
export const PROVIDER_OPTIONAL_ENV = Object.freeze({
  /** A second, distinct model id for the independent Review/Test roles (AC-043). */
  reviewModel: 'AGENTDEV_PROVIDER_REVIEW_MODEL',
  /** Declared model window; the drill defaults to a documented-safe 128k. */
  contextWindow: 'AGENTDEV_PROVIDER_CONTEXT_WINDOW',
  /** Declared per-call output cap; the drill defaults to 4096. */
  maxOutputTokens: 'AGENTDEV_PROVIDER_MAX_OUTPUT_TOKENS',
});

/**
 * The `secret_ref` the drill registers in the real SecretStore.
 *
 * `rules/agents.md` §5 keeps the credential out of `config.toml`; the ConfigStore row
 * names a ref and the SecretStore holds the value. The same ref is what a Work-scoped
 * `secret` Grant authorizes, so the Gateway resolves it through the product's own
 * admission path (`secretEnvName` derives `AGENTDEV_SECRET_AGENTDEV_LIVE_PROVIDER_CREDENTIAL`).
 */
export const LIVE_SECRET_REF = 'agentdev/live-provider-credential';

/** The exact refusal `test:live` prints when the configuration is incomplete. */
export function unconfiguredMessage(missing) {
  const names = missing.length > 0 ? missing : Object.values(PROVIDER_ENV);
  return `UNVERIFIED: real Provider not configured (set ${names.join(', ')})`;
}

/** Reads one environment variable, treating whitespace-only as absent. */
function envValue(env, name) {
  const raw = env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Parses a positive integer environment value, or `undefined`. */
function envInt(env, name, fallback) {
  const raw = envValue(env, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads the live Provider configuration from the environment.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *   configured: boolean,
 *   missing: string[],
 *   message: string,
 *   baseUrl: string,
 *   modelId: string,
 *   reviewModelId: string|null,
 *   secret: string,
 *   contextWindow: number,
 *   maxOutputTokens: number,
 * }}
 */
export function readProviderEnvironment(env = process.env) {
  const baseUrl = envValue(env, PROVIDER_ENV.baseUrl);
  const modelId = envValue(env, PROVIDER_ENV.model);
  const secret = envValue(env, PROVIDER_ENV.secret);
  const missing = [];
  if (baseUrl === undefined) missing.push(PROVIDER_ENV.baseUrl);
  if (modelId === undefined) missing.push(PROVIDER_ENV.model);
  if (secret === undefined) missing.push(PROVIDER_ENV.secret);
  return {
    configured: missing.length === 0,
    missing,
    message: unconfiguredMessage(missing),
    baseUrl: baseUrl ?? '',
    modelId: modelId ?? '',
    reviewModelId: envValue(env, PROVIDER_OPTIONAL_ENV.reviewModel) ?? null,
    secret: secret ?? '',
    contextWindow: envInt(env, PROVIDER_OPTIONAL_ENV.contextWindow, 128_000),
    maxOutputTokens: envInt(env, PROVIDER_OPTIONAL_ENV.maxOutputTokens, 4_096),
  };
}

/**
 * The absolute completion endpoint for one base URL.
 *
 * A base URL is the Provider root the user configured (`.../v1`); a caller that
 * already names the path keeps it verbatim, so both documented spellings work.
 *
 * @param {string} baseUrl
 */
export function chatCompletionsUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/u, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

/** One HTTP(S) POST with a JSON body, resolved to status + body text. */
function postJson(url, payload, headers, timeoutMs) {
  const target = new URL(url);
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const request = target.protocol === 'https:' ? httpsRequestBase : httpRequestBase;
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port === '' ? undefined : target.port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'content-length': String(body.byteLength),
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolvePromise({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', (error) => reject(error));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`the Provider request timed out after ${String(timeoutMs)}ms`));
    });
    req.write(body);
    req.end();
  });
}

/** Extracts the assistant text from an OpenAI-compatible completion body. */
export function extractCompletionText(payload) {
  const choices = payload?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = choices[0]?.message;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((part) =>
        typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '',
      )
      .filter((part) => part.length > 0);
    return parts.length === 0 ? null : parts.join('');
  }
  return null;
}

/** Reads the usage counters a Provider reports, defaulting to zero. */
function usageOf(payload) {
  const usage = payload?.usage ?? {};
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  return {
    inputTokens: Number.isFinite(input) && input > 0 ? input : 0,
    outputTokens: Number.isFinite(output) && output > 0 ? output : 0,
  };
}

/**
 * The real OpenAI-compatible transport.
 *
 * It implements the Gateway's `GatewayTransport` shape (`complete(request)`); the
 * request is built from the Run's *frozen* configuration, so the endpoint, model and
 * credential cannot be chosen per call by anything downstream of the Gateway.
 */
export class OpenAiCompatibleTransport {
  /** @param {{ secret?: string, timeoutMs?: number }} [options] */
  constructor(options = {}) {
    this.secret = options.secret ?? '';
    this.timeoutMs = options.timeoutMs ?? 120_000;
    /** Raw call evidence, one entry per HTTP request; never contains the secret. */
    this.calls = [];
  }

  /** Masks the configured credential in any recorded text. */
  mask(text) {
    const value = String(text ?? '');
    if (this.secret.length === 0) return value;
    return value.split(this.secret).join('[redacted]');
  }

  /** One completion; the transport contract of `model-gateway.ts`. */
  async complete(request) {
    const url = chatCompletionsUrl(request.baseUrl);
    const payload = {
      model: request.modelId,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      max_tokens: request.maxOutputTokens,
      stream: false,
    };
    const headers = { accept: 'application/json' };
    if (request.apiKey !== undefined) headers.authorization = `Bearer ${request.apiKey}`;
    const startedAt = Date.now();
    let response;
    try {
      response = await postJson(url, payload, headers, this.timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.calls.push({
        url,
        modelId: request.modelId,
        status: 0,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: this.mask(message),
      });
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        retryable: true,
        message: `the configured Provider could not be reached: ${this.mask(message)}`,
      };
    }
    const latencyMs = Date.now() - startedAt;
    if (response.status < 200 || response.status >= 300) {
      const excerpt = this.mask(response.text).slice(0, 500);
      this.calls.push({
        url,
        modelId: request.modelId,
        status: response.status,
        ok: false,
        latencyMs,
        error: excerpt,
      });
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        retryable: response.status === 429 || response.status >= 500,
        message: `the configured Provider answered HTTP ${String(response.status)}: ${excerpt}`,
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      this.calls.push({
        url,
        modelId: request.modelId,
        status: response.status,
        ok: false,
        latencyMs,
        error: 'the response body is not JSON',
      });
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        retryable: false,
        message: 'the configured Provider returned a non-JSON body',
      };
    }
    const text = extractCompletionText(parsed);
    if (text === null || text.trim().length === 0) {
      this.calls.push({
        url,
        modelId: request.modelId,
        status: response.status,
        ok: false,
        latencyMs,
        error: 'the response carries no assistant text',
      });
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        retryable: false,
        message: 'the configured Provider returned no completion text',
      };
    }
    const usage = usageOf(parsed);
    this.calls.push({
      url,
      modelId: request.modelId,
      status: response.status,
      ok: true,
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      responseChars: text.length,
    });
    return {
      ok: true,
      text,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  }

  /** A one-line, secret-free summary of every call for the drill report. */
  summary() {
    if (this.calls.length === 0) return 'no Provider call was made';
    const statuses = this.calls.map((call) => String(call.status)).join('/');
    const latency = this.calls.reduce((total, call) => total + call.latencyMs, 0);
    const failures = this.calls.filter((call) => !call.ok).length;
    return `${String(this.calls.length)} call(s), HTTP ${statuses}, ${String(latency)}ms total, ${String(failures)} failed`;
  }
}

/** Builds the real transport for the configured credential. */
export function createOpenAiCompatibleTransport(options = {}) {
  return new OpenAiCompatibleTransport(options);
}
