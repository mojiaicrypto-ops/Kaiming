/**
 * The streaming markdown splitter: a fenced block that has not closed yet must render as a growing
 * code block, never flash as a mis-parsed paragraph, and a finished fence must render once with the
 * whole body. This is the behaviour the transcript depends on while an answer is arriving.
 */
import { describe, expect, it } from 'vitest';
// The splitter is a pure function living next to the React renderer; the server's tsconfig has no
// JSX, so the module is imported as JS and typed by the local interface below.
// @ts-expect-error - .tsx module under the browser tsconfig (webapp/tsconfig.json owns its types)
import { splitTopLevelFences as rawSplitter } from '../webapp/src/chat/Markdown.tsx';

type Block = { kind: 'text'; text: string } | { kind: 'fence'; code: string; language: string };
const splitTopLevelFences = rawSplitter as (text: string) => Block[];

describe('splitTopLevelFences', () => {
  it('keeps an unclosed fence as a growing code block', () => {
    const blocks = splitTopLevelFences('前言\n\n```ts\nconst a = 1;\n');
    expect(blocks).toEqual([
      { kind: 'text', text: '前言\n' },
      { kind: 'fence', code: 'const a = 1;', language: 'ts' },
    ]);
  });

  it('closes the fence when the terminator arrives and keeps the following prose', () => {
    const blocks = splitTopLevelFences('前言\n\n```ts\nconst a = 1;\n```\n\n后记\n');
    expect(blocks).toEqual([
      { kind: 'text', text: '前言\n' },
      { kind: 'fence', code: 'const a = 1;', language: 'ts' },
      { kind: 'text', text: '\n\n后记\n' },
    ]);
  });

  it('handles several fences in one message and a fence with no language', () => {
    const blocks = splitTopLevelFences('```\nplain\n```\n\n中间\n\n```js\nlet x = 1;\n```\n');
    expect(blocks.filter((block) => block.kind === 'fence')).toEqual([
      { kind: 'fence', code: 'plain', language: '' },
      { kind: 'fence', code: 'let x = 1;', language: 'js' },
    ]);
    // The opening fence line consumes its own newline, so the prose between the fences keeps one.
    expect(blocks.filter((block) => block.kind === 'text').map((block) => (block.kind === 'text' ? block.text : ''))).toEqual([
      '\n\n中间\n',
      '\n',
    ]);
  });

  it('returns one text block for text without fences', () => {
    expect(splitTopLevelFences('just prose')).toEqual([{ kind: 'text', text: 'just prose' }]);
  });
});
