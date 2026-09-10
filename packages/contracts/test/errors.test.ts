import { describe, expect, it } from 'vitest';
import {
  CONDITIONAL_RETRYABLE_CODES,
  ERROR_CODES,
  ERROR_SPECS,
  errorBodySchema,
  errorCodeSchema,
  isRetryable,
} from '../src/index.js';

describe('protocol error codes', () => {
  it('contains every documented code exactly once', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toHaveLength(25);
  });

  it('marks only BUSY as unconditionally retryable', () => {
    const retryable = ERROR_CODES.filter((code) => isRetryable(code));
    expect([...retryable]).toEqual(['BUSY']);
  });

  it('retries a provider failure only when it is known side-effect free', () => {
    expect(isRetryable('PROVIDER_UNAVAILABLE')).toBe(false);
    expect(isRetryable('PROVIDER_UNAVAILABLE', { providerTransient: true })).toBe(true);
    expect(isRetryable('VERSION_CONFLICT', { providerTransient: true })).toBe(false);
  });

  it('keeps the static retryable flag equal to the unconditional answer', () => {
    for (const code of ERROR_CODES) {
      expect(isRetryable(code), code).toBe(ERROR_SPECS[code].retryable);
    }
  });

  it('names every conditionally retryable code', () => {
    for (const code of CONDITIONAL_RETRYABLE_CODES) {
      expect(isRetryable(code)).toBe(false);
      expect(isRetryable(code, { providerTransient: true })).toBe(true);
    }
  });

  it('gives every code a remediation hint', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_SPECS[code].remediation.length, code).toBeGreaterThan(0);
    }
  });

  it('rejects an undeclared code', () => {
    expect(errorCodeSchema.safeParse('TEAPOT').success).toBe(false);
    expect(errorCodeSchema.safeParse('VERSION_CONFLICT').success).toBe(true);
  });
});

describe('error body', () => {
  it('requires the documented fields', () => {
    expect(
      errorBodySchema.safeParse({
        code: 'VERSION_CONFLICT',
        message: 'stale',
        retryable: false,
      }).success,
    ).toBe(true);
    expect(errorBodySchema.safeParse({ code: 'VERSION_CONFLICT', message: 'stale' }).success).toBe(
      false,
    );
  });

  it('rejects undeclared fields', () => {
    expect(
      errorBodySchema.safeParse({
        code: 'BUSY',
        message: 'retry later',
        retryable: true,
        extra: 'nope',
      }).success,
    ).toBe(false);
  });
});
