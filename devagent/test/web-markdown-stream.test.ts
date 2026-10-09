import { describe, expect, it } from 'vitest';
// @ts-expect-error - the browser module is plain ESM JavaScript (no types shipped with the UI)
import { MarkdownStream, escapeHtml, heldBackTail } from '../web/components/stream/markdown-stream.js';

/** A markdown-it stand-in that records what it was asked to parse (the real one is vendored). */
function fakeMarkdown(): { readonly parsed: string[]; render(text: string): string } {
  const parsed: string[] = [];
  return {
    parsed,
    render(text) {
      parsed.push(text);
      return `<p>${escapeHtml(text)}</p>`;
    },
  };
}

describe('markdown stream', () => {
  it('holds back an unclosed fence until it closes', () => {
    const stream = new MarkdownStream({ markdownIt: fakeMarkdown() });

    stream.append('前言\n\n```ts\nconst a = 1;\n');

    // The fence swallows the tail: only the prose before it is parsed.
    expect(heldBackTail(stream.text)).toBe('```ts\nconst a = 1;\n');
    expect(stream.stablePrefix().stable).toBe('前言\n\n');

    stream.append('const b = 2;\n```\n');

    expect(heldBackTail(stream.text)).toBe('');
    expect(stream.stablePrefix().stable).toBe('前言\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n');
  });

  it('holds back an unfinished table row and a dangling inline marker', () => {
    expect(heldBackTail('| a | b |\n| - | - |\n| 1 ')).toBe('| 1 ');
    expect(heldBackTail('some **bold')).toBe('**bold');
    // A completed line is stable.
    expect(heldBackTail('| a | b |\n')).toBe('');
    expect(heldBackTail('**bold** done\n')).toBe('');
  });

  it('renders the held tail as pending text and replaces it when the block completes', () => {
    const markdown = fakeMarkdown();
    const stream = new MarkdownStream({ markdownIt: markdown });
    stream.append('| a | b |\n| 1 ');

    const interim = stream.render();
    expect(interim).toContain('stream-pending');
    expect(markdown.parsed).toEqual(['| a | b |\n']);

    stream.finish('| a | b |\n| - | - |\n| 1 | 2 |\n');
    const final = stream.render();

    // The finished render is authoritative: the whole document, once, with no pending fragment.
    expect(final).not.toContain('stream-pending');
    expect(markdown.parsed[markdown.parsed.length - 1]).toBe('| a | b |\n| - | - |\n| 1 | 2 |\n');
  });
});
