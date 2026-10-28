/**
 * The context meter's server-side facts: a live session's estimate, the unknown state right after
 * compaction, and the window-only reading for a session with no Pi instance.
 */
import { describe, expect, it } from 'vitest';
import {
  contextNoticeOf,
  contextUsageOf,
  windowOnlyContext,
  type ContextUsageView,
} from '../src/runtime/context-usage.ts';

/** The slice of Pi's ContextUsage these tests feed; the real type is structurally identical. */
interface FakeUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

function live(usage: FakeUsage | undefined, auto = true) {
  return { getContextUsage: () => usage, autoCompactionEnabled: auto };
}

describe('context usage of a live session', () => {
  it('reports tokens, window, percent and the auto-compaction setting', () => {
    expect(contextUsageOf(live({ tokens: 616_855, contextWindow: 1_000_000, percent: 61.6855 }, true))).toEqual({
      tokens: 616_855,
      contextWindow: 1_000_000,
      percent: 61.6855,
      autoCompaction: true,
      live: true,
    });
  });

  it('keeps the unknown token count after compaction instead of inventing one', () => {
    expect(contextUsageOf(live({ tokens: null, contextWindow: 1_000_000, percent: null }, false))).toEqual({
      tokens: null,
      contextWindow: 1_000_000,
      percent: null,
      autoCompaction: false,
      live: true,
    });
  });

  it('reports nothing when the model declares no context window', () => {
    expect(contextUsageOf(live(undefined))).toBeNull();
  });
});

describe('the window without a live instance', () => {
  it('shows only the window and marks the reading as not live', () => {
    expect(windowOnlyContext(1_000_000)).toEqual({
      tokens: null,
      contextWindow: 1_000_000,
      percent: null,
      autoCompaction: null,
      live: false,
    });
  });

  it('has nothing to show without a positive window', () => {
    expect(windowOnlyContext(undefined)).toBeNull();
    expect(windowOnlyContext(0)).toBeNull();
  });
});

describe('which Pi events move the context', () => {
  const session = live({ tokens: 1_000, contextWindow: 10_000, percent: 10 });
  const expected: ContextUsageView = {
    tokens: 1_000,
    contextWindow: 10_000,
    percent: 10,
    autoCompaction: true,
    live: true,
  };

  it('updates after an assistant response and after a compaction', () => {
    expect(contextNoticeOf({ type: 'message_end', message: { role: 'assistant' } }, session)).toEqual({
      type: 'context',
      context: expected,
    });
    expect(contextNoticeOf({ type: 'compaction_end' }, session)).toEqual({ type: 'context', context: expected });
  });

  it('stays silent for other messages, other events and a session without an instance', () => {
    expect(contextNoticeOf({ type: 'message_end', message: { role: 'user' } }, session)).toBeNull();
    expect(contextNoticeOf({ type: 'message_end', message: { role: 'toolResult' } }, session)).toBeNull();
    expect(contextNoticeOf({ type: 'message_start' }, session)).toBeNull();
    expect(contextNoticeOf({ type: 'agent_end' }, session)).toBeNull();
    expect(contextNoticeOf({ type: 'message_end', message: { role: 'assistant' } }, undefined)).toBeNull();
  });
});
