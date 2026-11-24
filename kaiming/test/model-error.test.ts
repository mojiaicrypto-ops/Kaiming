import { describe, expect, it } from 'vitest';
import { classifyModelFailure, publicFailureDetail } from '../src/runtime/model-error.ts';

const KIRO_MONTHLY =
  '429 {"type":"error","error":{"type":"rate_limit_error","message":"Kiro: usage limit reached: You have reached the limit. (MONTHLY_REQUEST_COUNT) (HTTP 429, rate_limit_error)"}}';

describe('provider failure classification', () => {
  it('classifies the observed Kiro monthly quota exhaustion as quota, not a generic rate limit', () => {
    // This is the real prepdex row, including the misleading "rate_limit_error" JSON type.
    expect(classifyModelFailure(KIRO_MONTHLY)).toBe('MODEL_QUOTA_EXHAUSTED');
  });

  it('keeps generic 429s as rate limits and does not steal quota wording from them', () => {
    expect(classifyModelFailure('429 Too Many Requests: rate limit exceeded')).toBe('MODEL_RATE_LIMITED');
    expect(classifyModelFailure('429 Rate limit reached for requests')).toBe('MODEL_RATE_LIMITED');
    expect(classifyModelFailure('rate_limit_error')).toBe('MODEL_RATE_LIMITED');
  });

  it('separates authentication and context-window failures', () => {
    expect(classifyModelFailure('401 Unauthorized: invalid API key')).toBe('MODEL_AUTH_FAILED');
    expect(classifyModelFailure('context length exceeded: reduce the length of the prompt')).toBe(
      'MODEL_CONTEXT_EXCEEDED',
    );
  });

  it('does not guess an unknown failure into a category', () => {
    expect(classifyModelFailure('500 internal server error: boom')).toBe('MODEL_ERROR');
    expect(classifyModelFailure('')).toBe('MODEL_ERROR');
    expect(classifyModelFailure(null)).toBe('MODEL_ERROR');
  });

  it('keeps provider detail visible but bounded', () => {
    expect(publicFailureDetail('  Kiro: usage limit reached  ')).toBe('Kiro: usage limit reached');
    const bounded = publicFailureDetail('x'.repeat(1_001));
    expect(bounded.length).toBe(1_001);
    expect(bounded.endsWith('…')).toBe(true);
  });
});
