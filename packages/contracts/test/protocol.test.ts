import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  acceptedResultSchema,
  appliedResultSchema,
  eventEnvelopeSchema,
  helloResultSchema,
  idSchema,
  idempotencyKeySchema,
  pageSchema,
  requestEnvelopeSchema,
  responseEnvelopeSchema,
  writeCommandFieldsSchema,
} from '../src/index.js';

const VALID_ID = '018f3f2a-1c4d-7b2e-8a3f-0d1e2f3a4b5c';
const VALID_HASH = 'c'.repeat(64);
const PROJECT_ID = 'd'.repeat(32);

describe('request envelope', () => {
  it('accepts the documented shape', () => {
    const result = requestEnvelopeSchema.safeParse({
      v: 1,
      type: 'request',
      id: 'conn-1',
      method: 'work.get',
      projectId: PROJECT_ID,
      params: { workId: VALID_ID },
    });
    expect(result.success).toBe(true);
  });

  it('requires protocol version 1', () => {
    expect(
      requestEnvelopeSchema.safeParse({ v: 2, type: 'request', id: 'x', method: 'm', params: {} })
        .success,
    ).toBe(false);
  });

  it('rejects unknown envelope fields', () => {
    expect(
      requestEnvelopeSchema.safeParse({
        v: 1,
        type: 'request',
        id: 'x',
        method: 'm',
        params: {},
        trace: 'nope',
      }).success,
    ).toBe(false);
  });
});

describe('responses', () => {
  it('discriminates ok from error responses', () => {
    const ok = responseEnvelopeSchema.safeParse({
      v: 1,
      type: 'response',
      id: 'x',
      ok: true,
      result: { status: 'applied', entityId: VALID_ID, version: 3 },
    });
    const failed = responseEnvelopeSchema.safeParse({
      v: 1,
      type: 'response',
      id: 'x',
      ok: false,
      error: { code: 'NOT_FOUND', message: 'missing', retryable: false },
    });
    expect(ok.success).toBe(true);
    expect(failed.success).toBe(true);
  });

  it('keeps accepted and applied results distinct', () => {
    expect(
      acceptedResultSchema.safeParse({ status: 'accepted', operationId: VALID_ID }).success,
    ).toBe(true);
    expect(
      appliedResultSchema.safeParse({ status: 'applied', entityId: VALID_ID, version: 1 }).success,
    ).toBe(true);
    expect(
      acceptedResultSchema.safeParse({ status: 'applied', entityId: VALID_ID, version: 1 }).success,
    ).toBe(false);
  });
});

describe('write command fields', () => {
  it('requires an idempotency key and a non-negative expected version', () => {
    expect(
      writeCommandFieldsSchema.safeParse({ idempotencyKey: 'k', expectedVersion: 0 }).success,
    ).toBe(true);
    expect(writeCommandFieldsSchema.safeParse({ idempotencyKey: 'k' }).success).toBe(false);
    expect(
      writeCommandFieldsSchema.safeParse({ idempotencyKey: 'k', expectedVersion: -1 }).success,
    ).toBe(false);
  });

  it('bounds the idempotency key to 1..128 characters', () => {
    expect(idempotencyKeySchema.safeParse('').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('k'.repeat(128)).success).toBe(true);
    expect(idempotencyKeySchema.safeParse('k'.repeat(129)).success).toBe(false);
  });
});

describe('events, pages and hello', () => {
  it('carries cursor, entity version and payload on an event', () => {
    expect(
      eventEnvelopeSchema.safeParse({
        v: 1,
        type: 'event',
        eventId: VALID_ID,
        projectId: PROJECT_ID,
        cursor: 12,
        name: 'work.control_changed',
        entityId: VALID_ID,
        entityVersion: 4,
        data: { status: 'paused' },
      }).success,
    ).toBe(true);
  });

  it('paginates with an opaque cursor', () => {
    const page = pageSchema(idSchema);
    expect(page.safeParse({ items: [VALID_ID] }).success).toBe(true);
    expect(page.safeParse({ items: [VALID_ID], nextCursor: 'opaque' }).success).toBe(true);
    expect(page.safeParse({ items: ['not-an-id'] }).success).toBe(false);
  });

  it('reports protocol version and server time on hello', () => {
    const parsed = helloResultSchema.safeParse({
      connectionId: VALID_ID,
      protocolVersion: 1,
      serverTime: '2026-09-11T00:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
    expect(PROTOCOL_VERSION).toBe(1);
    expect(VALID_HASH).toHaveLength(64);
  });
});
