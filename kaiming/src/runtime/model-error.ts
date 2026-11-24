/**
 * Provider failures are classified once, at the boundary where Pi reports them, so the page can
 * say what the user must do instead of rendering an empty turn.
 *
 * The provider text is the evidence and is never hidden; the code only adds a stable sentence and
 * an actionable next step. Classification is deliberately conservative: an unknown failure stays
 * `MODEL_ERROR` rather than being guessed into a category.
 */

export type ModelFailureCode =
  | 'MODEL_AUTH_FAILED'
  | 'MODEL_CONTEXT_EXCEEDED'
  | 'MODEL_QUOTA_EXHAUSTED'
  | 'MODEL_RATE_LIMITED'
  | 'MODEL_ERROR';

const AUTH_FAILURE =
  /\b(401|403)\b|unauthori[sz]ed|unauthenticated|authentication|invalid[^"]*(api[ _-]?key|token)|incorrect[^"]*(api[ _-]?key|token)|api[ _-]?key|credential|token[^"]*(expired|invalid)|permission denied|forbidden/iu;
const QUOTA_FAILURE =
  /quota|usage[ _-]?limit|monthly|request[ _-]?count|credit|billing|balance|payment|spending|out[ _-]?of[ _-]?budget|insufficient[ _-]?funds/iu;
const RATE_FAILURE = /\b429\b|rate[ _-]?limit|too many requests|throttl|overloaded|temporarily unavailable/iu;
const CONTEXT_FAILURE =
  /context[ _-]?(length|window)|maximum[ _-]?context|too many[ _-]?tokens|token[ _-]?limit|prompt[^"]*too[ _-]?long|reduce[^"]*length/iu;

export function classifyModelFailure(providerError: string | null | undefined): ModelFailureCode {
  const text = (providerError ?? '').trim();
  if (text === '') return 'MODEL_ERROR';
  // Authentication first: a 401 can also quote the word "quota" in a generic message, and
  // telling the user to wait would hide the credential that actually needs replacing.
  if (AUTH_FAILURE.test(text)) return 'MODEL_AUTH_FAILED';
  if (QUOTA_FAILURE.test(text)) return 'MODEL_QUOTA_EXHAUSTED';
  if (RATE_FAILURE.test(text)) return 'MODEL_RATE_LIMITED';
  if (CONTEXT_FAILURE.test(text)) return 'MODEL_CONTEXT_EXCEEDED';
  return 'MODEL_ERROR';
}

/** The provider's own words, kept to a size a browser can show without becoming the screen. */
export function publicFailureDetail(detail: string | null | undefined, limit = 1_000): string {
  const text = (detail ?? '').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
