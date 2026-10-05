/**
 * Local model credentials for real-model checks.
 *
 * The file (`devagent/config/model.json`) is gitignored and never logged. Real-model checks read it
 * here so the same code can target a cloud provider (API key via environment, built-in catalog) or a
 * custom/local OpenAI-compatible endpoint (written into a temporary models.json).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ModelConfig {
  readonly provider: string;
  readonly model: string;
  /** Provider env vars (e.g. ANTHROPIC_API_KEY) applied to this process before creating a session. */
  readonly env: Record<string, string>;
  /** Extra models.json providers, empty when the built-in catalog already describes the endpoint. */
  readonly providers: Record<string, unknown>;
}

export type ModelConfigResult =
  | { readonly ok: true; readonly config: ModelConfig }
  | { readonly ok: false; readonly error: string };

export const MODEL_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'config',
  'model.json',
);

function stringMap(value: unknown, field: string): Record<string, string> | string {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || value === null) {
    return `${field} must be an object`;
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      return `${field}.${key} must be a string`;
    }
    out[key] = item;
  }
  return out;
}

export function parseModelConfig(raw: unknown): ModelConfigResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'config must be a JSON object' };
  }
  const record = raw as Record<string, unknown>;
  const provider = record['provider'];
  const model = record['model'];
  if (typeof provider !== 'string' || provider.length === 0 || provider === 'REPLACE_ME') {
    return { ok: false, error: 'provider must be set to a real provider id' };
  }
  if (typeof model !== 'string' || model.length === 0 || model === 'REPLACE_ME') {
    return { ok: false, error: 'model must be set to a real model id' };
  }
  const env = stringMap(record['env'], 'env');
  if (typeof env === 'string') {
    return { ok: false, error: env };
  }
  const endpoint = record['endpoint'];
  let providers: Record<string, unknown> = {};
  if (endpoint !== undefined) {
    if (typeof endpoint !== 'object' || endpoint === null) {
      return { ok: false, error: 'endpoint must be an object' };
    }
    const endpointRecord = endpoint as Record<string, unknown>;
    const baseUrl = endpointRecord['baseUrl'];
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
      return { ok: false, error: 'endpoint.baseUrl must be a non-empty string' };
    }
    const api = endpointRecord['api'];
    const apiKey = endpointRecord['apiKey'];
    providers = {
      [provider]: {
        baseUrl,
        ...(typeof api === 'string' ? { api } : {}),
        ...(typeof apiKey === 'string' ? { apiKey } : {}),
        models: [{ id: model, name: model }],
      },
    };
  }
  return { ok: true, config: { provider, model, env, providers } };
}

export function loadModelConfig(path: string = MODEL_CONFIG_PATH): ModelConfigResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, error: `cannot read ${path}; copy config/model.example.json and fill it in` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  return parseModelConfig(parsed);
}