/**
 * The private credential store (R5): the provider definitions Pi actually reads, kept in the server's
 * private directory next to the database - never in a project, never in a response.
 *
 * The file is Pi's own `models.json` shape, so what `config.test` probes is exactly what a run uses.
 * A key is merged into the existing file (the operator's own providers stay untouched) and the file
 * is written atomically with 0600 before the database records only its reference.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ProviderDefinition {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly api?: string;
  /** The label the user sees. Pi's provider schema carries it too, so the file stays self-describing. */
  readonly name?: string;
  /** Omitted when the caller only changes the catalog and keeps the existing key. */
  readonly apiKey?: string;
  /**
   * Declared input modalities. Defaults to text and image: Pi's catalog treats a provider entry that
   * declares nothing as text-only and then drops every image silently, which looks like a broken
   * upload. An endpoint that really cannot take images answers with an error the user can see.
   */
  readonly input?: readonly string[];
  readonly models: readonly { id: string; name: string }[];
}

export type ProviderWriteResult =
  | { readonly ok: true; readonly credentialRef: string }
  | { readonly ok: false; readonly message: string };

export function modelsPathFor(agentDir: string): string {
  return join(agentDir, 'models.json');
}

/** The reference recorded in the database: a location, never a secret. */
export function credentialRefFor(providerId: string): string {
  return `models.json#providers.${providerId}`;
}

/** The provider definitions currently on disk, so a save can merge instead of replacing. */
export function readProviders(agentDir: string): Record<string, unknown> {
  const path = modelsPathFor(agentDir);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { providers?: unknown };
    return parsed.providers !== null && typeof parsed.providers === 'object'
      ? { ...(parsed.providers as Record<string, unknown>) }
      : {};
  } catch {
    // A file we cannot parse is not something to overwrite silently: the caller reports the failure.
    return {};
  }
}

export function writeProvider(agentDir: string, definition: ProviderDefinition): ProviderWriteResult {
  if (typeof definition.baseUrl !== 'string' || definition.baseUrl === '') {
    return { ok: false, message: 'baseUrl is required' };
  }
  const providers = readProviders(agentDir);
  const existing = providers[definition.providerId];
  const previous =
    existing !== null && typeof existing === 'object' ? (existing as Record<string, unknown>) : {};
  const previousKey = typeof previous['apiKey'] === 'string' ? previous['apiKey'] : undefined;
  const apiKey = definition.apiKey ?? previousKey;
  if (apiKey === undefined || apiKey === '') {
    return { ok: false, message: 'apiKey is required for a new provider' };
  }
  providers[definition.providerId] = {
    baseUrl: definition.baseUrl,
    ...(definition.api !== undefined ? { api: definition.api } : {}),
    ...(definition.name !== undefined ? { name: definition.name } : {}),
    apiKey,
    models: definition.models.map((model) => ({
      id: model.id,
      name: model.name,
      input: [...(definition.input ?? ['text', 'image'])],
    })),
  };
  const path = modelsPathFor(agentDir);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ providers }, null, 2), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  } catch (error) {
    return { ok: false, message: `the credential store could not be written: ${String(error)}` };
  }
  return { ok: true, credentialRef: credentialRefFor(definition.providerId) };
}
