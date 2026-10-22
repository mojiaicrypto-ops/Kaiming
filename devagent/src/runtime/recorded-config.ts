/**
 * The configuration a claimed input recorded, cut to what a reader may see.
 *
 * One definition, used by the read surface and by the stream snapshot: the settings page can change
 * a model at any time, and both must report what the work *used*, not what the settings now say.
 * The recorded value also carries the server's own directories, which never travel to the browser.
 */
export interface RecordedConfig {
  readonly providerId: string;
  readonly modelId: string;
  readonly source: string;
}

export function summarizeRecordedConfig(recorded: string | null): RecordedConfig | null {
  if (recorded === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(recorded);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const providerId = record['providerId'];
  const modelId = record['modelId'];
  if (typeof providerId !== 'string' || typeof modelId !== 'string') return null;
  const source = record['source'];
  return { providerId, modelId, source: typeof source === 'string' ? source : 'unknown' };
}

/** The newest recorded configuration in a session, preferring the input that is running now. */
export function recordedConfigOf(
  inputs: readonly { readonly status: string; readonly effectiveConfig: string | null }[],
): string | null {
  const running = inputs.find((input) => input.status === 'processing' && input.effectiveConfig !== null);
  if (running !== undefined) return running.effectiveConfig;
  for (let index = inputs.length - 1; index >= 0; index -= 1) {
    const candidate = inputs[index];
    if (candidate !== undefined && candidate.effectiveConfig !== null) return candidate.effectiveConfig;
  }
  return null;
}
