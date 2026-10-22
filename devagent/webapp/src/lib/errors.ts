import { RpcError } from '../api/rpc';
import type { Translate } from '../i18n/I18nProvider';
import { CATALOG, MESSAGE_KEYS } from '../i18n/catalog';

/**
 * One place that turns a failure into words the interface may show.
 *
 * The server's own message is written for the operator (English, and often a sentence about the
 * record), so it is the *second* line: the first line is a stable, translated sentence for the
 * code. An unknown code keeps its text — inventing a friendly sentence for a condition we did not
 * expect would hide it.
 */
export function errorText(cause: unknown, t: Translate): string {
  if (cause instanceof RpcError) {
    const key = `error.${cause.code}`;
    if (MESSAGE_KEYS.includes(key as never)) {
      const known = t(key as Parameters<Translate>[0]);
      return cause.message === '' ? known : `${known} — ${cause.message}`;
    }
    // An unexpected code keeps its text: a friendly sentence for a condition we did not expect
    // would hide the condition.
    return cause.message === '' ? cause.code : `${cause.code} — ${cause.message}`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
