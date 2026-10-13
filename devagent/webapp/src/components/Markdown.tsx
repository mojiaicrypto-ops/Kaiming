import { useEffect, useMemo, useRef } from 'react';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import yaml from 'highlight.js/lib/languages/yaml';
import diff from 'highlight.js/lib/languages/diff';
import markdown from 'highlight.js/lib/languages/markdown';
import { takeHighlightBudget, waitForHighlight } from '../lib/highlight-queue';

let registered = false;
function registerLanguages(): void {
  if (registered) return;
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('diff', diff);
  hljs.registerLanguage('markdown', markdown);
  registered = true;
}

const markdownIt = new MarkdownIt({
  breaks: true,
  linkify: true,
  highlight(code, language) {
    registerLanguages();
    if (typeof language === 'string' && language !== '' && hljs.getLanguage(language) !== undefined) {
      // Budgeted: long or numerous fences render plain first and gain colors in idle slices.
      if (takeHighlightBudget(code.length)) {
        return hljs.highlight(code, { language }).value;
      }
      return '';
    }
    return '';
  },
});

interface CodeBlockProps {
  code: string;
  language: string;
}

function CodeBlock({ code, language }: CodeBlockProps) {
  const [html, setHtml] = useMemoState(() =>
    typeof language === 'string' && language !== '' && hljs.getLanguage(language) !== undefined && takeHighlightBudget(code.length)
      ? hljs.highlight(code, { language }).value
      : null,
  [code, language]);
  useEffect(() => {
    if (html !== null) return;
    let cancelled = false;
    const cancel = waitForHighlight(() => {
      if (!cancelled) {
        setHtml(hljs.highlight(code, { language }).value);
      }
    });
    return () => {
      cancelled = true;
      cancel();
    };
  }, [html, code, language, setHtml]);
  return html === null
    ? <pre><code className={`language-${language}`}>{code}</code></pre>
    : <pre><code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: html }} /></pre>;
}

// tiny memo-state helper (avoid pulling extra hooks libs)
import { useState } from 'react';
function useMemoState<T>(init: () => T, deps: readonly unknown[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(init);
  useEffect(() => { setValue(init()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, deps);
  return [value, setValue];
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => splitTopLevelFences(text), [text]);
  return (
    <div className="markdown-body">
      {blocks.map((block, index) =>
        block.kind === 'fence'
          ? <CodeBlock key={index} code={block.code} language={block.language} />
          : <div key={index} dangerouslySetInnerHTML={{ __html: markdownIt.render(block.text) }} />,
      )}
    </div>
  );
}

interface TextBlock { kind: 'text'; text: string }
interface FenceBlock { kind: 'fence'; code: string; language: string }

/**
 * Split into top-level text runs and fenced code so streaming can keep an unclosed fence
 * rendering as a growing code block (never flashes a mis-parsed paragraph).
 */
export function splitTopLevelFences(text: string): ReadonlyArray<TextBlock | FenceBlock> {
  const blocks: Array<TextBlock | FenceBlock> = [];
  let rest = text;
  for (;;) {
    const open = /(^|\n)```(\w*)[^\n]*\n/.exec(rest);
    if (open === null || open.index === undefined) {
      if (rest !== '') blocks.push({ kind: 'text', text: rest });
      break;
    }
    const before = rest.slice(0, open.index);
    if (before !== '') blocks.push({ kind: 'text', text: before });
    const afterOpen = rest.slice(open.index + open[0].length);
    const close = afterOpen.indexOf('\n```');
    if (close === -1) {
      // Unclosed fence: render as a growing code block.
      blocks.push({ kind: 'fence', code: afterOpen.replace(/\n$/, ''), language: open[2] ?? '' });
      break;
    }
    blocks.push({ kind: 'fence', code: afterOpen.slice(0, close).replace(/\n$/, ''), language: open[2] ?? '' });
    rest = afterOpen.slice(close + 4);
  }
  return blocks;
}
