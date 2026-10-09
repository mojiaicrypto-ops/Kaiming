/**
 * The live view of one session: the message list, the streaming content blocks and the open questions.
 *
 * Streaming rules (P4-h): deltas accumulate per content block, a *completed* event replaces the
 * accumulated text with the authoritative content (PI sends the finished content in `text_end` /
 * `message_end`), and rendering is coalesced per animation frame so a burst of deltas paints once.
 */
import { rafSchedule } from './dom.js';

export class SessionView {
  constructor() {
    this.messages = [];
    this.blocks = new Map();
    this.activity = 'idle';
    this.currentInputId = null;
    this.pending = [];
    this.listeners = new Set();
    this.dirty = false;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify = rafSchedule(() => {
    this.dirty = false;
    for (const listener of this.listeners) {
      listener(this);
    }
  });

  /** Apply a snapshot (prepare or a resync): the whole conversation is replaced. */
  applySnapshot(snapshot) {
    this.messages = (snapshot.messages ?? []).map((message) => ({
      entryId: message.entryId,
      role: message.role,
      content: message.content,
      inputId: message.inputId,
      streaming: false,
    }));
    this.blocks.clear();
    this.activity = snapshot.activity ?? 'idle';
    this.currentInputId = snapshot.currentInputId ?? null;
    this.pending = snapshot.interactions ?? [];
    this.notify();
  }

  /** Apply one live frame: Pi events build the transcript, notices refresh the open questions. */
  applyFrame(frame) {
    if (frame.type === 'invalidate') {
      this.notify();
      return;
    }
    if (frame.type !== 'pi') {
      return;
    }
    const event = frame.event;
    switch (event?.type) {
      case 'message_start': {
        const message = event.message ?? {};
        if (message.role === 'assistant') {
          this.messages.push({
            entryId: `live-${frame.seq}`,
            role: 'assistant',
            content: message.content ?? [],
            inputId: frame.inputId ?? null,
            streaming: true,
          });
          this.notify();
        }
        return;
      }
      case 'message_update': {
        this.#applyDelta(frame.seq, event.assistantMessageEvent);
        return;
      }
      case 'message_end': {
        this.#applyComplete(event.message, frame.seq, frame.inputId);
        return;
      }
      // A tool result arrives as its own `toolResult` message (PI emits both
      // `tool_execution_end` and that message): only the message is rendered, so one call yields
      // exactly one card and the result text is the real content, not a stringified object.
      case 'agent_start':
        this.activity = 'processing';
        this.notify();
        return;
      case 'agent_settled':
      case 'agent_end':
        this.activity = 'idle';
        this.notify();
        return;
      default:
        return;
    }
  }

  #applyDelta(seq, assistantEvent) {
    if (assistantEvent === undefined || assistantEvent === null) {
      return;
    }
    const current = this.messages[this.messages.length - 1];
    if (current === undefined || current.role !== 'assistant') {
      return;
    }
    const index = assistantEvent.contentIndex ?? 0;
    const block = this.#blockOf(current, index);
    const delta = assistantEvent.delta ?? '';
    switch (assistantEvent.type) {
      case 'text_delta':
        block.type = 'text';
        block.text = (block.text ?? '') + delta;
        break;
      case 'thinking_delta':
        block.type = 'thinking';
        block.thinking = (block.thinking ?? '') + delta;
        break;
      case 'toolcall_delta':
        block.type = 'toolCall';
        block.arguments = (block.arguments ?? '') + delta;
        break;
      default:
        return;
    }
    block.seq = seq;
    this.notify();
  }

  #applyComplete(message, seq, inputId) {
    if (message === undefined || message === null) {
      return;
    }
    const index = this.messages.findIndex((entry) => entry.streaming === true);
    const completed = {
      // Keep the key the streaming entry already had: re-keying would leave its node behind.
      entryId: message.id ?? this.messages[index]?.entryId ?? `live-${seq}`,
      role: message.role ?? 'assistant',
      content: message.content ?? [],
      inputId: inputId ?? null,
      streaming: false,
      stopReason: message.stopReason,
    };
    if (index >= 0) {
      this.messages[index] = completed;
    } else if (message.role === 'user' || message.role === 'toolResult') {
      this.messages.push(completed);
    }
    this.notify();
  }

  #blockOf(message, index) {
    if (!Array.isArray(message.content)) {
      message.content = [];
    }
    while (message.content.length <= index) {
      message.content.push({ type: 'text', text: '' });
    }
    return message.content[index];
  }

  /** The open questions for this session (from the snapshot). */
  setPending(interactions) {
    this.pending = interactions;
    this.notify();
  }
}
