/**
 * Streaming markdown (P4-h): the incremental safety layer around markdown-it.
 *
 * Nothing here parses markdown itself - markdown-it does, and it renders complete documents. What we
 * own is *when* it is safe to parse: while a block is still arriving we hold back the unstable tail
 * (an unclosed fence, the last incomplete table row, a half-written inline marker) and render the
 * stable prefix; when the block is complete we parse the whole text once and replace the preview, so
 * the final render is identical to a one-shot render of the finished document.
 */
const INLINE_MARKERS = ['```', '~~~', '**', '__', '`', '~~', '[', '('];

export class MarkdownStream {
  constructor({ markdownIt, highlight }) {
    this.markdownIt = markdownIt;
    this.highlight = highlight;
    this.text = '';
    this.complete = false;
    this.renderedText = null;
  }

  append(delta) {
    this.text += delta;
  }

  /** Mark the block complete: the next render is authoritative and replaces the preview. */
  finish(text) {
    if (typeof text === 'string') {
      this.text = text;
    }
    this.complete = true;
  }

  /** The stable prefix that can be parsed now, and whether more was held back. */
  stablePrefix() {
    if (this.complete) {
      return { stable: this.text, held: '' };
    }
    const held = heldBackTail(this.text);
    if (held === '') {
      return { stable: this.text, held: '' };
    }
    return { stable: this.text.slice(0, this.text.length - held.length), held };
  }

  /** Render the current state to HTML: the stable prefix parsed, the held tail appended verbatim. */
  render() {
    const { stable, held } = this.stablePrefix();
    const html = this.markdownIt.render(stable);
    // `renderedText` lets the caller skip a re-render when nothing changed.
    this.renderedText = stable;
    return held === '' ? html : `${html}<p class="stream-pending">${escapeHtml(held)}</p>`;
  }
}

/**
 * The unstable tail: an unterminated fence swallows everything after it; otherwise the tail from the
 * last line that cannot be interpreted yet (an unclosed table, a dangling inline marker).
 */
export function heldBackTail(text) {
  const fence = lastUnclosedFence(text);
  if (fence !== undefined) {
    return text.slice(fence);
  }
  const lines = text.split('\n');
  // A table row is stable only once its line is finished; an unfinished last line is held.
  if (/\n$/.test(text)) {
    return '';
  }
  const lastLine = lines[lines.length - 1] ?? '';
  if (lastLine.trim() === '' || lastLine.trim() === '') {
    return '';
  }
  if (/^\s*\|/.test(lastLine) || /^\s*\|?[-: ]+\|/.test(lastLine)) {
    // An open table row: hold it until its line completes.
    return lastLine;
  }
  const dangling = INLINE_MARKERS.find((marker) => countUnescaped(text, marker) % 2 === 1);
  if (dangling !== undefined) {
    const index = text.lastIndexOf(dangling);
    return index < 0 ? '' : text.slice(index);
  }
  return '';
}

function lastUnclosedFence(text) {
  let openAt;
  let marker;
  const pattern = /^(```|~~~)/gm;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const fence = match[1];
    if (openAt === undefined) {
      openAt = match.index;
      marker = fence;
      continue;
    }
    if (fence === marker) {
      openAt = undefined;
      marker = undefined;
    }
  }
  return openAt;
}

function countUnescaped(text, marker) {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith(marker, index) && text[index - 1] !== '\\') {
      count += 1;
      index += marker.length - 1;
    }
  }
  return count;
}

export function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
