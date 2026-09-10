import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { toPiSessionEvent } from '../src/events.js';

/**
 * Streaming mapping coverage (AC-066 "流式").
 *
 * These cases drive every branch of the SDK→Runner translation with SDK-shaped
 * events. Delivering a live delta stream end to end needs a model turn and runs
 * in the WP-10 live matrix; the mapping itself is deterministic and covered here.
 */
const asEvent = (value: unknown): AgentSessionEvent => value as AgentSessionEvent;

describe('SDK event mapping', () => {
  it('maps lifecycle events', () => {
    expect(toPiSessionEvent(asEvent({ type: 'agent_start' }))).toEqual({ type: 'agent_start' });
    expect(toPiSessionEvent(asEvent({ type: 'turn_start' }))).toEqual({ type: 'turn_start' });
    expect(toPiSessionEvent(asEvent({ type: 'turn_end' }))).toEqual({ type: 'turn_end' });
    expect(toPiSessionEvent(asEvent({ type: 'agent_end', messages: [{}, {}, {}] }))).toEqual({
      type: 'agent_end',
      messageCount: 3,
    });
  });

  it('maps assistant text and thinking deltas', () => {
    expect(
      toPiSessionEvent(
        asEvent({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
        }),
      ),
    ).toEqual({ type: 'text_delta', delta: 'hello' });
    expect(
      toPiSessionEvent(
        asEvent({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
        }),
      ),
    ).toEqual({ type: 'thinking_delta', delta: 'hmm' });
  });

  it('keeps an unmodelled assistant update as a raw event', () => {
    expect(
      toPiSessionEvent(
        asEvent({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_start' },
        }),
      ),
    ).toEqual({ type: 'raw', eventType: 'text_start' });
  });

  it('maps tool execution boundaries', () => {
    expect(toPiSessionEvent(asEvent({ type: 'tool_execution_start', toolName: 'read' }))).toEqual({
      type: 'tool_start',
      toolName: 'read',
    });
    expect(
      toPiSessionEvent(asEvent({ type: 'tool_execution_end', toolName: 'read', isError: true })),
    ).toEqual({ type: 'tool_end', toolName: 'read', isError: true });
  });

  it('maps compaction boundaries', () => {
    expect(toPiSessionEvent(asEvent({ type: 'compaction_start' }))).toEqual({
      type: 'compaction_start',
    });
    expect(toPiSessionEvent(asEvent({ type: 'compaction_end' }))).toEqual({
      type: 'compaction_end',
    });
  });

  it('reports queue depth instead of the queued texts', () => {
    expect(
      toPiSessionEvent(asEvent({ type: 'queue_update', steering: ['a'], followUp: ['b', 'c'] })),
    ).toEqual({ type: 'queue_update', steering: 1, followUp: 2 });
  });

  it('passes an unknown event type through as raw', () => {
    expect(toPiSessionEvent(asEvent({ type: 'auto_retry_start' }))).toEqual({
      type: 'raw',
      eventType: 'auto_retry_start',
    });
  });
});
