/**
 * The thinking levels Pi offers for a model.
 *
 * The SDK decides this in `getSupportedThinkingLevels` (pi-ai), which the package root does not
 * export, so the rule is mirrored here — it is a pure function of two fields on the model the
 * catalog returns: `reasoning` and `thinkingLevelMap`. Keep it in step with the SDK: a model that
 * does not declare reasoning accepts only `off`; `xhigh`/`max` exist only where the model maps them
 * explicitly; `null` in the map removes a level.
 */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export interface ThinkCapableModel {
  readonly reasoning?: boolean;
  readonly thinkingLevelMap?: Readonly<Record<string, string | null>> | undefined;
}

export function supportedThinkingLevels(model: ThinkCapableModel): readonly string[] {
  if (model.reasoning !== true) return ['off'];
  return LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
}
