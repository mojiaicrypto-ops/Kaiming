/**
 * The archive policy is deliberately request-local: keep images that a later assistant response has
 * already consumed until the next request, then replace them once. The tests pin both sides of that
 * line: current tool images stay visible, consumed images become a stable placeholder, user images
 * are never rewritten, and an archived prefix does not change when new messages arrive.
 */
import { describe, expect, it } from 'vitest';
import type { ContextEvent, ContextEventResult, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ARCHIVED_IMAGE_TEXT, archiveOldToolImages, createHistoryImageArchiveExtension } from '../src/runtime/history-image-archive.ts';

type ContextMessage = ContextEvent['messages'][number];
type Content = Array<{ type: string; [key: string]: unknown }>;

const image = (name: string): { type: 'image'; data: string; mimeType: string } => ({
  type: 'image',
  data: name,
  mimeType: 'image/png',
});

const text = (value: string): { type: 'text'; text: string } => ({ type: 'text', text: value });

const assistant = (stopReason: 'stop' | 'error' | 'aborted' = 'stop'): ContextMessage =>
  ({
    role: 'assistant',
    content: [text('reply')],
    api: 'stub',
    provider: 'stub',
    model: 'stub-1',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 1,
  }) as ContextMessage;

const user = (content: Content): ContextMessage =>
  ({ role: 'user', content, timestamp: 1 }) as unknown as ContextMessage;

const toolResult = (id: string, content: Content): ContextMessage =>
  ({
    role: 'toolResult',
    toolCallId: id,
    toolName: 'browser',
    content,
    isError: false,
    timestamp: 1,
  }) as unknown as ContextMessage;

function imageBlocks(messages: readonly ContextMessage[]): Array<{ data: string }> {
  const images: Array<{ data: string }> = [];
  for (const message of messages) {
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'image' && typeof block.data === 'string') images.push({ data: block.data });
    }
  }
  return images;
}

function toolContent(messages: readonly ContextMessage[], index: number): Content {
  const message = messages[index];
  return ((message as { content?: Content } | undefined)?.content ?? []) as Content;
}

describe('history image archive', () => {
  it('keeps the current tool batch until an assistant response consumes it', () => {
    const current = [
      user([image('user-reference')]),
      assistant(),
      toolResult('t-current', [text('screenshot 1'), image('current-shot')]),
    ];
    const untouched = archiveOldToolImages(current);
    expect(untouched).toBe(current);
    expect(imageBlocks(untouched).map((block) => block.data)).toEqual(['user-reference', 'current-shot']);

    const consumed = [...current, assistant()];
    const archived = archiveOldToolImages(consumed);
    expect(archived).not.toBe(consumed);
    expect(imageBlocks(archived).map((block) => block.data)).toEqual(['user-reference']);
    expect(toolContent(archived, 2)).toContainEqual({ type: 'text', text: ARCHIVED_IMAGE_TEXT });
    expect(toolContent(archived, 2)).toContainEqual(text('screenshot 1'));
  });

  it('archives every image in one consumed parallel tool-result batch', () => {
    const current = [
      assistant(),
      toolResult('t-1', [image('one'), image('two')]),
      toolResult('t-2', [image('three')]),
    ];
    expect(imageBlocks(archiveOldToolImages(current))).toHaveLength(3);

    const archived = archiveOldToolImages([...current, assistant()]);
    expect(imageBlocks(archived)).toHaveLength(0);
    expect(archived[1]?.role).toBe('toolResult');
    for (const index of [1, 2]) {
      expect(toolContent(archived, index).filter((block) => block.type === 'image')).toHaveLength(0);
      expect(toolContent(archived, index).filter((block) => block.text === ARCHIVED_IMAGE_TEXT)).toHaveLength(
        index === 1 ? 2 : 1,
      );
    }
  });

  it('never rewrites user images, even when they are older than the last assistant', () => {
    const messages = [
      user([image('user-evidence')]),
      assistant(),
      toolResult('t-old', [image('tool-shot')]),
      assistant(),
    ];
    const archived = archiveOldToolImages(messages);
    expect(imageBlocks(archived).map((block) => block.data)).toEqual(['user-evidence']);
    expect(archived[0]).toBe(messages[0]);
  });

  it('does not archive a batch after only an error or aborted assistant message', () => {
    const failed = [assistant(), toolResult('t-current', [image('current-shot')]), assistant('error')];
    expect(imageBlocks(archiveOldToolImages(failed)).map((block) => block.data)).toEqual(['current-shot']);
    const aborted = [assistant(), toolResult('t-current', [image('current-shot')]), assistant('aborted')];
    expect(imageBlocks(archiveOldToolImages(aborted)).map((block) => block.data)).toEqual(['current-shot']);
    expect(imageBlocks(archiveOldToolImages([...failed, assistant()]))).toHaveLength(0);
  });

  it('is idempotent and leaves all already-archived text unchanged', () => {
    const messages = [assistant(), toolResult('t-old', [image('old-shot')]), assistant()];
    const first = archiveOldToolImages(messages);
    const second = archiveOldToolImages(first);
    expect(second).toBe(first);
    expect(toolContent(first, 1).filter((block) => block.type === 'image')).toHaveLength(0);
  });

  it('does not rewrite an archived prefix when a new user message is appended', () => {
    const messages = [assistant(), toolResult('t-old', [image('old-shot')]), assistant()];
    const archived = archiveOldToolImages(messages);
    const later = archiveOldToolImages([...messages, user([text('next')])]);
    expect(later.slice(0, archived.length)).toEqual(archived);
  });

  it('keeps the archived prefix stable when a new tool batch arrives', () => {
    const messages = [assistant(), toolResult('t-old', [image('old-shot')]), assistant()];
    const archived = archiveOldToolImages(messages);
    const later = archiveOldToolImages([...messages, assistant(), toolResult('t-new', [image('new-shot')])]);
    expect(later.slice(0, archived.length)).toEqual(archived);
    expect(imageBlocks(later).map((block) => block.data)).toEqual(['new-shot']);
  });

  it('does not mutate its input and is a no-op when no image needs archiving', () => {
    const messages = [user([image('user-reference')]), assistant()];
    const snapshot = structuredClone(messages);
    expect(archiveOldToolImages(messages)).toBe(messages);
    expect(messages).toEqual(snapshot);
  });

  it('does not mutate its input when it actually archives images', () => {
    const messages = [assistant(), toolResult('t-old', [image('old-shot'), text('facts')]), assistant('stop')];
    const snapshot = structuredClone(messages);
    const archived = archiveOldToolImages(messages);
    expect(archived).not.toBe(messages);
    expect(messages).toEqual(snapshot);
    expect(archived[1]).not.toBe(messages[1]);
  });

  it('registers the archive as a request-local context handler', () => {
    const handlers: Array<{
      readonly event: string;
      readonly handler: (event: ContextEvent) => ContextEventResult | undefined;
    }> = [];
    const pi = {
      on: (event: string, handler: (event: ContextEvent) => ContextEventResult | undefined) => {
        handlers.push({ event, handler });
        return () => undefined;
      },
    } as unknown as ExtensionAPI;
    createHistoryImageArchiveExtension()(pi);

    const handler = handlers.find((entry) => entry.event === 'context')?.handler;
    expect(handler).toBeTypeOf('function');
    const result = handler?.({
      type: 'context',
      messages: [assistant(), toolResult('t-old', [image('old-shot')]), assistant()],
    });
    expect(result).toBeDefined();
    expect(imageBlocks(result?.messages ?? [])).toHaveLength(0);
  });
});
