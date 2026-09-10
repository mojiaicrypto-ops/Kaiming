/**
 * SDK event mapping.
 *
 * The Runner forwards these events to the Core; the SDK's own event objects
 * never leave `@agentdev/pi-runtime`. `ARCHITECTURE.md` §3 fixes the boundary:
 * "只在pi-runtime引用SDK类型。……外部API不使用Pi内部字段."
 *
 * Only the streaming shapes the Core needs are translated; anything else is
 * passed through as `raw` so an SDK upgrade cannot silently drop a signal.
 */
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

/** Events the Runner forwards; the SDK's own event objects never escape. */
export type PiSessionEvent =
  | { readonly type: 'agent_start' }
  | { readonly type: 'agent_end'; readonly messageCount: number }
  | { readonly type: 'turn_start' }
  | { readonly type: 'turn_end' }
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'thinking_delta'; readonly delta: string }
  | { readonly type: 'tool_start'; readonly toolName: string }
  | { readonly type: 'tool_end'; readonly toolName: string; readonly isError: boolean }
  | { readonly type: 'compaction_start' }
  | { readonly type: 'compaction_end' }
  | { readonly type: 'queue_update'; readonly steering: number; readonly followUp: number }
  | { readonly type: 'raw'; readonly eventType: string };

export type PiSessionListener = (event: PiSessionEvent) => void;

/** Translates one SDK event; unmodelled events keep their type for diagnosis. */
export function toPiSessionEvent(event: AgentSessionEvent): PiSessionEvent {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent_start' };
    case 'agent_end':
      return { type: 'agent_end', messageCount: event.messages.length };
    case 'turn_start':
      return { type: 'turn_start' };
    case 'turn_end':
      return { type: 'turn_end' };
    case 'message_update': {
      const update = event.assistantMessageEvent;
      if (update.type === 'text_delta') return { type: 'text_delta', delta: update.delta };
      if (update.type === 'thinking_delta') return { type: 'thinking_delta', delta: update.delta };
      return { type: 'raw', eventType: update.type };
    }
    case 'tool_execution_start':
      return { type: 'tool_start', toolName: event.toolName };
    case 'tool_execution_end':
      return { type: 'tool_end', toolName: event.toolName, isError: event.isError };
    case 'compaction_start':
      return { type: 'compaction_start' };
    case 'compaction_end':
      return { type: 'compaction_end' };
    case 'queue_update':
      return {
        type: 'queue_update',
        steering: event.steering.length,
        followUp: event.followUp.length,
      };
    default:
      return { type: 'raw', eventType: event.type };
  }
}
