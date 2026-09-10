import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_LIMITS,
  ATTACHMENT_LIMITS,
  AUTH_LIMITS,
  CONTEXT_LIMITS,
  INITIALIZATION_BUDGET,
  LIMITS,
  PROTOCOL_LIMITS,
  withinBounds,
} from '../src/index.js';

describe('architecture defaults', () => {
  it('matches the documented default table', () => {
    expect(LIMITS.globalConcurrentRunners.default).toBe(8);
    expect(LIMITS.projectConcurrentRunners.default).toBe(4);
    expect(LIMITS.roleConcurrency.default).toBe(2);
    expect(LIMITS.taskWriterCount.default).toBe(1);
    expect(LIMITS.workInputOutputTokens.default).toBe(500_000);
    expect(LIMITS.workActiveTimeSec.default).toBe(7_200);
    expect(LIMITS.reviewRepairRounds.default).toBe(3);
    expect(LIMITS.providerRetries.default).toBe(2);
    expect(LIMITS.shellTimeoutSec.default).toBe(120);
    expect(LIMITS.heartbeatSec.default).toBe(5);
    expect(LIMITS.leaseSec.default).toBe(20);
    expect(LIMITS.cancelGraceSec.default).toBe(10);
    expect(LIMITS.idleSessionTtlSec.default).toBe(300);
    expect(LIMITS.eventRetentionDays.default).toBe(30);
  });

  it('keeps the documented bounds', () => {
    expect([LIMITS.globalConcurrentRunners.min, LIMITS.globalConcurrentRunners.max]).toEqual([
      1, 32,
    ]);
    expect([LIMITS.projectConcurrentRunners.min, LIMITS.projectConcurrentRunners.max]).toEqual([
      1, 16,
    ]);
    expect([LIMITS.roleConcurrency.min, LIMITS.roleConcurrency.max]).toEqual([1, 8]);
    expect([LIMITS.workInputOutputTokens.min, LIMITS.workInputOutputTokens.max]).toEqual([
      1_000, 10_000_000,
    ]);
    expect([LIMITS.workActiveTimeSec.min, LIMITS.workActiveTimeSec.max]).toEqual([60, 86_400]);
    expect([LIMITS.reviewRepairRounds.min, LIMITS.reviewRepairRounds.max]).toEqual([0, 10]);
    expect([LIMITS.shellTimeoutSec.min, LIMITS.shellTimeoutSec.max]).toEqual([1, 1_800]);
  });

  it('marks fixed constants as non-overridable', () => {
    for (const name of [
      'taskWriterCount',
      'providerRetries',
      'heartbeatSec',
      'leaseSec',
      'cancelGraceSec',
      'idleSessionTtlSec',
    ] as const) {
      expect(LIMITS[name].fixed, name).toBe(true);
      expect(LIMITS[name].min, name).toBe(LIMITS[name].max);
    }
  });

  it('validates a candidate value against its bounds', () => {
    expect(withinBounds('roleConcurrency', 2)).toBe(true);
    expect(withinBounds('roleConcurrency', 9)).toBe(false);
    expect(withinBounds('roleConcurrency', 0)).toBe(false);
    expect(withinBounds('reviewRepairRounds', 0)).toBe(true);
    expect(withinBounds('globalConcurrentRunners', Number.NaN)).toBe(false);
  });

  it('keeps queue and request byte ceilings exact', () => {
    expect(LIMITS.mailboxItems.default).toBe(256);
    expect(LIMITS.mailboxBytes.default).toBe(4 * 1024 * 1024);
    expect(LIMITS.connectionQueueSoftBytes.default).toBe(2 * 1024 * 1024);
    expect(LIMITS.connectionQueueHardBytes.default).toBe(8 * 1024 * 1024);
    expect(LIMITS.requestLimitBytes.default).toBe(1024 * 1024);
  });
});

describe('context, initialization and attachment budgets', () => {
  it('matches the context budget rules', () => {
    expect(CONTEXT_LIMITS.profileDefaultTokens).toBe(64_000);
    expect(CONTEXT_LIMITS.startupTokens).toBe(24_000);
    expect(CONTEXT_LIMITS.expansionTokens).toBe(16_000);
    expect(CONTEXT_LIMITS.minTokens).toBe(4_096);
    expect(CONTEXT_LIMITS.maxTokens).toBe(2_000_000);
    expect(CONTEXT_LIMITS.reservedTokens).toBe(4_096);
  });

  it('matches the initialization read budget', () => {
    expect(INITIALIZATION_BUDGET.maxBodyFiles).toBe(40);
    expect(INITIALIZATION_BUDGET.maxBodyBytes).toBe(512 * 1024);
    expect(INITIALIZATION_BUDGET.maxIndexEntries).toBe(10_000);
  });

  it('matches the attachment and artifact limits', () => {
    expect(ATTACHMENT_LIMITS.maxPerMessage).toBe(5);
    expect(ATTACHMENT_LIMITS.maxBytesEach).toBe(20 * 1024 * 1024);
    expect(ATTACHMENT_LIMITS.maxBytesTotal).toBe(50 * 1024 * 1024);
    expect(ATTACHMENT_LIMITS.stagedTtlHours).toBe(24);
    expect(ARTIFACT_LIMITS.inlinePreviewMaxBytes).toBe(1024 * 1024);
    expect(ARTIFACT_LIMITS.inlinePreviewMaxLines).toBe(2_000);
    expect(ARTIFACT_LIMITS.downloadTokenTtlSec).toBe(60);
  });

  it('matches the protocol and auth limits', () => {
    expect(PROTOCOL_LIMITS.messageBodyMaxChars).toBe(64_000);
    expect(PROTOCOL_LIMITS.idempotencyKeyMaxChars).toBe(128);
    expect(PROTOCOL_LIMITS.defaultPageLimit).toBe(50);
    expect(PROTOCOL_LIMITS.maxPageLimit).toBe(200);
    expect(PROTOCOL_LIMITS.maxArrayItems).toBe(1_000);
    expect(AUTH_LIMITS.sessionHours).toBe(24);
    expect(AUTH_LIMITS.loginAttemptsPerIpPerMinute).toBe(5);
  });
});
