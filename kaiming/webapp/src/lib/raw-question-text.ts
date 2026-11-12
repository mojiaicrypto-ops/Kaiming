/**
 * Hide model-authored `<question>` markup from assistant text. The runtime normally replaces this
 * markup at `message_end`, but streaming shows text deltas before that boundary and older history
 * still contains the raw block. Fenced code is data (an answer may legitimately show the syntax), so
 * only text outside fences is stripped. An unterminated opener is removed through the end of the
 * text: while the model is still streaming, the user should never see half a tool-call tag.
 */
const FENCE = /^\s*```/;

function stripOutsideFences(text: string): string {
  const lower = text.toLowerCase();
  let cursor = 0;
  let result = '';
  for (;;) {
    const start = lower.indexOf('<question', cursor);
    if (start < 0) {
      result += text.slice(cursor);
      return result;
    }
    const close = lower.indexOf('</question>', start);
    if (close < 0) {
      // Incomplete block: drop the remainder rather than render an unanswerable partial call.
      return result + text.slice(cursor, start);
    }
    result += text.slice(cursor, start);
    cursor = close + '</question>'.length;
  }
}

export function hideRawQuestionMarkup(text: string): string {
  if (!text.toLowerCase().includes('<question')) return text;
  const output: string[] = [];
  let outside: string[] = [];
  let fence: string[] = [];
  let inFence = false;
  const flushOutside = (): void => {
    if (outside.length > 0) output.push(stripOutsideFences(outside.join('\n')));
    outside = [];
  };
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      if (inFence) {
        fence.push(line);
        output.push(fence.join('\n'));
        fence = [];
        inFence = false;
      } else {
        flushOutside();
        inFence = true;
        fence = [line];
      }
    } else if (inFence) {
      fence.push(line);
    } else {
      outside.push(line);
    }
  }
  if (inFence) {
    output.push(fence.join('\n'));
  } else {
    flushOutside();
  }
  return output.join('\n');
}
