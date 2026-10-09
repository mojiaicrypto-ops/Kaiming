/**
 * The Chief view: the conversation, the open questions and the composer (the mock's .conversation).
 *
 * Update discipline (P4 plan §5): the transcript is append-only, a message's streaming blocks are
 * updated in place, and a snapshot (prepare/resync) replaces the whole list. Nothing here re-renders a
 * finished message, so a long conversation stays cheap.
 */
import { el, qs, rafSchedule, relativeTime, replace } from '../core/dom.js';
import { MarkdownStream } from '../components/stream/markdown-stream.js';
import { createThinkingBlock } from '../components/stream/thinking-block.js';
import { createToolCard } from '../components/stream/tool-card.js';
import { renderInteractions } from '../components/interaction-card.js';

export function createChiefView(context) {
  const { store, sessionView, i18n, toast, markdownIt, highlight } = context;
  const container = qs('#chiefView');
  const transcript = qs('#projectMessages');
  const interactionsRegion = el('div', { class: 'interaction-region', hidden: true });
  const stageStrip = qs('#stageStrip');
  const composer = qs('#composer');
  // The shell's real composer: a form with #messageInput and a submit button.
  const input = qs('#messageInput');
  const sendButton = qs('#composer .send-button');
  const rendered = new Map();
  let lastSnapshotApplied = null;
  /** The message list object we last rendered: a new list means the conversation was replaced. */
  let pendingSend = null;
  /** True while one submit is in flight; cleared in `finally` so a failure never locks the composer. */
  let sending = false;

  transcript?.before(interactionsRegion);

  const paint = rafSchedule(() => {
    if (lastSnapshotApplied !== null && sessionView.messages !== lastSnapshotApplied) {
      // The conversation was replaced (snapshot, resync, another session): drop the nodes that
      // belonged to the previous list instead of appending the new one under the old.
      rendered.clear();
      transcript.replaceChildren();
      interactionsRegion.replaceChildren();
    }
    if (lastSnapshotApplied === null || sessionView.messages !== lastSnapshotApplied) {
      lastSnapshotApplied = sessionView.messages;
    }
    for (const message of sessionView.messages) {
      renderMessage(message);
    }
    paintInteractions();
    paintStage();
  });

  function renderMessage(message) {
    if (message.role === 'toolResult') {
      renderToolResult(message);
      return;
    }
    if (message.role === 'system') {
      // PI stores the role context as a system entry: it is not conversation, but it is not hidden
      // either - it renders as one collapsed note.
      const key = `system-${message.entryId ?? sessionView.messages.indexOf(message)}`;
      if (!rendered.has(key)) {
        const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
        const note = el('details', { class: 'system-note' }, [
          el('summary', { text: `system · ${text.length} chars` }),
          el('pre', { text }),
        ]);
        rendered.set(key, { node: note, body: note, blocks: new Map(), message });
        transcript.append(note);
      }
      return;
    }
    const key = message.entryId ?? `${message.role}-${sessionView.messages.indexOf(message)}`;
    let entry = rendered.get(key);
    if (entry === undefined) {
      const body = el('div', { class: 'message-body' });
      const node = el('article', { class: `message ${message.role}` }, [
        el('div', { class: 'avatar', text: avatarOf(message.role) }),
        el('div', { class: 'message-content' }, [
          el('div', { class: 'message-meta' }, [
            el('strong', { text: message.role }),
            el('span', { text: relativeTime(message.timestamp) }),
          ]),
          body,
        ]),
      ]);
      entry = { node, body, blocks: new Map(), message };
      rendered.set(key, entry);
      transcript.append(node);
    }
    entry.message = message;
    renderBlocks(entry);
  }

  /** A tool result arrives as its own message: it flips the card of the call it answers. */
  function renderToolResult(message) {
    const key = `result-${message.entryId ?? sessionView.messages.indexOf(message)}`;
    if (rendered.has(key)) {
      return;
    }
    const text = Array.isArray(message.content)
      ? message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
      : String(message.content ?? '');
    const failed = /^Error:/m.test(text);
    // The card that shows this call's arguments flips; only an unmatched result gets its own card.
    const callId = message.toolCallId ?? '';
    for (const entry of rendered.values()) {
      if (entry.kind === 'tool' && callId !== '' && entry.callId === callId && entry.tool.status === 'running') {
        entry.tool.finish({ ok: !failed, text });
        rendered.set(key, { node: entry.node, body: entry.body, blocks: entry.blocks, message });
        return;
      }
    }
    const tool = createToolCard({ name: message.toolName ?? 'tool', callId: message.toolCallId ?? key });
    tool.finish({ ok: !failed, text });
    rendered.set(key, { node: tool.node, body: tool.node, blocks: new Map(), message });
    transcript.append(tool.node);
  }

  function renderBlocks(entry) {
    const content = Array.isArray(entry.message.content)
      ? entry.message.content
      : typeof entry.message.content === 'string'
        ? [{ type: 'text', text: entry.message.content }]
        : [];
    content.forEach((block, index) => {
      let blockEntry = entry.blocks.get(index);
      if (blockEntry === undefined) {
        blockEntry = createBlock(block, index);
        entry.blocks.set(index, blockEntry);
        entry.body.append(blockEntry.node);
      }
      applyBlock(entry, blockEntry, block);
    });
  }

  function createBlock(block, index) {
    if (block.type === 'thinking') {
      const thinking = createThinkingBlock();
      return { kind: 'thinking', node: thinking.node, thinking };
    }
    if (block.type === 'toolCall') {
      const callId = block.id ?? `block-${index}`;
      const tool = createToolCard({ name: block.name, callId });
      return { kind: 'tool', node: tool.node, tool, callId };
    }
    const stream = new MarkdownStream({ markdownIt, highlight });
    const node = el('div', { class: 'markdown-body' });
    return { kind: 'text', node, stream };
  }

  function applyBlock(entry, blockEntry, block) {
    const streaming = entry.message?.streaming === true;
    if (blockEntry.kind === 'thinking') {
      const text = block.thinking ?? '';
      if (text.length > blockEntry.thinking.text.length) {
        blockEntry.thinking.append(text.slice(blockEntry.thinking.text.length));
      }
      if (!streaming) {
        // A completed block is authoritative: it replaces whatever was accumulated.
        blockEntry.thinking.finish(text);
      }
      return;
    }
    if (blockEntry.kind === 'tool') {
      const args = typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? {});
      if (args.length > (blockEntry.argsText ?? '').length) {
        blockEntry.tool.appendArguments(args.slice((blockEntry.argsText ?? '').length));
        blockEntry.argsText = args;
      }
      return;
    }
    const text = block.text ?? '';
    if (text !== blockEntry.stream.text) {
      if (text.startsWith(blockEntry.stream.text)) {
        blockEntry.stream.append(text.slice(blockEntry.stream.text.length));
      } else {
        blockEntry.stream.text = text;
      }
    }
    if (!streaming) {
      blockEntry.stream.finish(text);
    }
    replace(blockEntry.node, el('div', { html: blockEntry.stream.render() }));
  }

  function paintInteractions() {
    const pending = store.pendingInteractions ?? [];
    interactionsRegion.hidden = pending.length === 0;
    renderInteractions(interactionsRegion, pending, {
      t: (key) => i18n.t(key),
      onAnswer: async (interactionId, revision, response) => {
        await store.answerInteraction(interactionId, revision, response);
        toast.success(i18n.t('toast.answered') ?? 'Answered');
      },
    });
  }

  function paintStage() {
    if (stageStrip === null) {
      return;
    }
    const task = store.tasks.find((entry) => entry.status === 'active' || entry.status === 'waiting') ?? store.tasks[0];
    if (task === undefined) {
      stageStrip.hidden = true;
      return;
    }
    stageStrip.hidden = false;
    const order = ['clarify', 'analyze', 'design', 'plan', 'develop', 'review', 'test', 'settle'];
    const current = order.indexOf(task.phase);
    replace(
      stageStrip,
      ...order.map((phase, index) =>
        el(
          'div',
          {
            class: `stage ${index < current ? 'done' : index === current ? 'current' : 'pending'}`,
            role: 'listitem',
            ...(index === current ? { 'aria-current': 'step' } : {}),
          },
          [el('span', { class: 'stage-mark', text: index < current ? '✓' : index === current ? '●' : '' }), el('span', { text: phase })],
        ),
      ),
    );
  }

  async function send() {
    if (sending) {
      // One send at a time: a second Enter while the first is in flight must not submit twice.
      return;
    }
    const text = input?.value?.trim() ?? '';
    if (text === '') {
      return;
    }
    // One id per user action (R1): the same text retries with the same id, a new text gets a new one.
    if (pendingSend === null || pendingSend.text !== text) {
      pendingSend = { text, requestId: context.newRequestId() };
    }
    sending = true;
    if (sendButton !== null) {
      sendButton.disabled = true;
    }
    if (input !== null) {
      input.disabled = true;
    }
    try {
      await store.submit([{ type: 'text', text }], { requestId: pendingSend.requestId });
      if (input !== null) {
        input.value = '';
      }
      pendingSend = null;
    } catch (error) {
      toast.error(error?.message ?? String(error));
      // Keep the text and its id so the next press retries the same action; `sending` is cleared
      // below whatever happens, so a failure can never leave the composer unusable.
      if (input !== null) {
        input.value = text;
      }
    } finally {
      sending = false;
      if (sendButton !== null) {
        sendButton.disabled = false;
      }
      if (input !== null) {
        input.disabled = false;
        input.focus();
      }
    }
  }

  composer?.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.shiftKey === false) {
      event.preventDefault();
      void send();
    }
  });

  const unsubscribe = sessionView.subscribe(() => paint());

  return {
    id: 'chief',
    mount() {
      paint();
    },
    update() {
      paint();
    },
    destroy() {
      unsubscribe();
    },
  };
}

function avatarOf(role) {
  if (role === 'user') {
    return 'U';
  }
  if (role === 'chief' || role === 'assistant') {
    return 'CH';
  }
  return String(role ?? '??').slice(0, 2).toUpperCase();
}
