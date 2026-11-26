/**
 * History-image archive (context hygiene): tool-result screenshots are useful while the model is
 * looking at them, but every later request would otherwise carry every old screenshot. Archiving
 * them request-locally keeps the Pi JSONL and attachment store untouched while bounding the vision
 * input.
 *
 * The policy is deliberately monotonic and role-based, not a sliding count:
 *  - user-role images are never rewritten (they are evidence, and replacing an old user image would
 *    change a prefix far from the end);
 *  - tool-result images are kept only while they are newer than the last successful assistant
 *    message; once an assistant reply has consumed that batch, the next request replaces it with one
 *    fixed text block. Error/aborted assistant messages do not count as a successful reply.
 *
 * Replacing an already archived block is a no-op, and the placeholder has no timestamp, count or
 * generated ID. A request therefore changes only the tail that has just been consumed; earlier
 * provider prompt-cache prefixes stay byte-identical.
 */
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';

type ContextMessage = ContextEvent['messages'][number];

/** Fixed, cache-stable replacement for an archived tool-result image. */
export const ARCHIVED_IMAGE_TEXT =
  '[archived image: omitted from model context; the original bytes remain in session history. Re-open or recapture the source if needed.]';

function archiveToolResult(
  message: Extract<ContextMessage, { role: 'toolResult' }>,
): Extract<ContextMessage, { role: 'toolResult' }> {
  let changed = false;
  const content = message.content.map((block) => {
    if (block.type !== 'image') return block;
    changed = true;
    return { type: 'text' as const, text: ARCHIVED_IMAGE_TEXT };
  });
  return changed ? { ...message, content } : message;
}

/**
 * Archive tool-result images that a later assistant message has already consumed. Pure: returns the
 * original array when nothing changed, and never mutates the input messages.
 */
export function archiveOldToolImages(messages: ContextEvent['messages']): ContextEvent['messages'] {
  let lastAssistant = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    if (message.stopReason !== 'error' && message.stopReason !== 'aborted') lastAssistant = index;
  }
  if (lastAssistant < 0) return messages;

  let changed = false;
  const next = messages.map((message, index) => {
    if (message.role !== 'toolResult' || index > lastAssistant) return message;
    const archived = archiveToolResult(message);
    if (archived !== message) changed = true;
    return archived;
  });
  return changed ? next : messages;
}

/** Install the request-local archive on every Pi session. */
export function createHistoryImageArchiveExtension(): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    pi.on('context', (event: ContextEvent) => {
      const messages = archiveOldToolImages(event.messages);
      return messages === event.messages ? undefined : { messages };
    });
  };
}
