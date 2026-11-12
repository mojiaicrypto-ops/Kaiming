/**
 * Recovery for a model that writes an interactive question as assistant text instead of calling the
 * Pi `question` tool. The runtime must not show unanswerable markup to the user: when a complete
 * `<question …>…</question>` block ends the final assistant text, it becomes the same durable
 * interaction the tool would create, the block is removed from the finalized message, and the answer
 * returns to the same run as a hidden custom user message.
 *
 * This is deliberately a last line of defence. The prompt and tool description still tell the model
 * to call the tool; this parser only accepts the exact shape and only at the end of the message, so
 * prose that merely discusses the markup does not become a dialog.
 */
import type { ExtensionAPI, ExtensionFactory, MessageEndEvent } from '@earendil-works/pi-coding-agent';
import type { InteractionBridge } from './interactions.ts';
import { parseQuestionParams, type QuestionRequest } from '../tools/question-tool.ts';

/** A custom message that carries the recovered answer to the model but never appears in the browser. */
export const RAW_QUESTION_ANSWER_CUSTOM_TYPE = 'kaiming.raw-question-answer';

type Message = MessageEndEvent['message'];

interface TextBlock {
  readonly type: 'text';
  readonly text: string;
  readonly [key: string]: unknown;
}

interface ContentBlockRecord {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly name?: unknown;
}

export interface ExtractedQuestion {
  readonly request: QuestionRequest;
  /** Offsets in the source text, used to remove the block. */
  readonly start: number;
  readonly end: number;
}

export interface RawQuestionExtraction {
  readonly questions: readonly ExtractedQuestion[];
  readonly cleaned: string;
}

/** Decode only the five XML entities a model actually emits; numeric entities are handled too. */
function decodeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const numeric = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : whole;
  });
}

function attributesOf(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of raw.matchAll(pattern)) {
    const name = match[1] ?? '';
    if (name === '') continue;
    attributes[name] = decodeXml(match[2] ?? match[3] ?? '');
  }
  return attributes;
}

/** `<options>one</options>` repeated, or a single block with one option per line. */
function optionsOf(body: string): string[] {
  const options: string[] = [];
  const pattern = /<options?\b[^>]*>([\s\S]*?)<\/options?>/gi;
  for (const match of body.matchAll(pattern)) {
    const inner = decodeXml(match[1] ?? '').trim();
    if (inner === '') continue;
    const lines = inner
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => line.replace(/^[-*•]\s+/, ''));
    if (lines.length > 1) {
      options.push(...lines);
    } else {
      options.push(lines[0] ?? inner);
    }
  }
  return options;
}

/** A complete raw question block. `start`/`end` are the offsets to remove. */
interface BlockMatch {
  readonly start: number;
  readonly end: number;
  readonly opening: string;
  readonly body: string;
}

function questionBlocks(text: string): readonly BlockMatch[] {
  const blocks: BlockMatch[] = [];
  const opening = /<question\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  const closing = /<\/question>/gi;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(text)) !== null) {
    const start = match.index;
    closing.lastIndex = opening.lastIndex;
    const close = closing.exec(text);
    if (close === null) break;
    const end = close.index + close[0].length;
    blocks.push({ start, end, opening: match[1] ?? '', body: text.slice(opening.lastIndex, close.index) });
    // The block body is markup, not another opening tag.
    opening.lastIndex = end;
  }
  return blocks;
}

/** True when the offset sits inside a Markdown code fence (```), where a markup example is data. */
function insideCodeFence(text: string, offset: number): boolean {
  const before = text.slice(0, offset);
  const fences = before.match(/```/g) ?? [];
  return fences.length % 2 === 1;
}

/**
 * Parse complete raw question blocks only when the last one ends the text. That positional rule is
 * the false-positive guard: a normal answer that quotes the markup in an example keeps its text.
 */
export function extractTrailingRawQuestions(text: string): RawQuestionExtraction | undefined {
  const blocks = questionBlocks(text);
  if (blocks.length === 0) return undefined;
  const last = blocks[blocks.length - 1];
  const endOfText = text.trimEnd().length;
  if (last === undefined || last.end !== endOfText) return undefined;

  const questions: ExtractedQuestion[] = [];
  for (const block of blocks) {
    if (insideCodeFence(text, block.start)) return undefined;
    const attributes = attributesOf(block.opening);
    const method = attributes['method'];
    const title = attributes['title'];
    if (method === undefined || title === undefined) return undefined;
    const options = optionsOf(block.body);
    const parsed = parseQuestionParams({
      method,
      title,
      ...(attributes['message'] !== undefined ? { message: attributes['message'] } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(attributes['placeholder'] !== undefined ? { placeholder: attributes['placeholder'] } : {}),
    });
    if ('error' in parsed) return undefined;
    questions.push({ request: parsed.request, start: block.start, end: block.end });
  }
  if (questions.length === 0) return undefined;

  let cleaned = text;
  for (const question of [...questions].sort((a, b) => b.start - a.start)) {
    cleaned = cleaned.slice(0, question.start) + cleaned.slice(question.end);
  }
  return { questions, cleaned: cleaned.trimEnd() };
}

function answerText(answer: unknown): string {
  if (typeof answer === 'boolean') return answer ? 'yes' : 'no';
  if (typeof answer === 'string') return answer;
  return answer === undefined || answer === null ? '' : String(answer);
}

/** The hidden user-visible-to-model message that lets the same run continue after the answer. */
export function rawQuestionAnswerMessage(answers: ReadonlyArray<{ readonly request: QuestionRequest; readonly answer: unknown }>): string {
  const lines = [
    'The interactive question you wrote as assistant text was shown to the user through the host question panel.',
    'The user answered it:',
  ];
  for (const [index, entry] of answers.entries()) {
    if (answers.length > 1) lines.push(`${String(index + 1)}. ${entry.request.title} (${entry.request.method})`);
    else lines.push(`${entry.request.title} (${entry.request.method})`);
    if (entry.request.message !== undefined && entry.request.message !== '') {
      lines.push(`   Question: ${entry.request.message}`);
    }
    if (entry.request.options !== undefined && entry.request.options.length > 0) {
      lines.push(`   Options: ${entry.request.options.join(' | ')}`);
    }
    lines.push(`   Answer: ${answerText(entry.answer)}`);
  }
  lines.push('Continue from this answer. Do not ask the same question again.');
  return lines.join('\n');
}

function textBlockIndex(content: readonly unknown[]): number {
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index] as ContentBlockRecord | null;
    if (block?.type === 'text' && typeof block.text === 'string') return index;
  }
  return -1;
}

function replaceText(content: readonly unknown[], index: number, text: string): readonly unknown[] {
  return content.map((block, current) =>
    current === index && typeof block === 'object' && block !== null ? { ...(block as Record<string, unknown>), text } : block,
  );
}

/**
 * True for the private answer message. The server skips these frames so the model gets the answer
 * while the browser keeps seeing only the interaction panel and the next assistant message.
 */
export function isHiddenRawQuestionAnswerEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false;
  const record = event as { type?: unknown; message?: { role?: unknown; customType?: unknown } };
  if (record.type !== 'message_start' && record.type !== 'message_end' && record.type !== 'message_update') return false;
  return record.message?.role === 'custom' && record.message?.customType === RAW_QUESTION_ANSWER_CUSTOM_TYPE;
}

export interface RawQuestionRecoveryOptions {
  readonly bridge: InteractionBridge;
  readonly sessionId: string;
  readonly inputId: string;
  readonly taskId?: string;
}

/**
 * Install the recovery in one Pi session. `message_end` fires before persistence and before the
 * public event listeners, so the replacement is what the store, snapshot and live frame see.
 */
export function createRawQuestionRecovery(options: RawQuestionRecoveryOptions): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    pi.on('message_end', async (event, ctx) => {
      const message = event.message as Message;
      if (message.role !== 'assistant') return undefined;
      const content = Array.isArray(message.content) ? message.content : [];
      // A real tool call already has the native path; never add a second interaction for the same turn.
      if (content.some((block) => {
        const record = block as ContentBlockRecord | null;
        return record?.type === 'toolCall';
      })) {
        return undefined;
      }
      const index = textBlockIndex(content);
      if (index < 0) return undefined;
      const block = content[index] as TextBlock;
      const extraction = extractTrailingRawQuestions(block.text);
      if (extraction === undefined || !ctx.hasUI) return undefined;

      const answers: Array<{ request: QuestionRequest; answer: unknown }> = [];
      try {
        for (const question of extraction.questions) {
          const answer = await options.bridge.ask({
            sessionId: options.sessionId,
            inputId: options.inputId,
            ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
            method: question.request.method,
            title: question.request.title,
            ...(question.request.message !== undefined ? { message: question.request.message } : {}),
            ...(question.request.options !== undefined ? { options: question.request.options } : {}),
            ...(question.request.placeholder !== undefined ? { placeholder: question.request.placeholder } : {}),
            ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
          });
          answers.push({ request: question.request, answer });
        }
      } catch {
        // A stopped input cannot be answered. Hide the unanswerable markup; the run is already ending.
        return { message: { ...message, content: replaceText(content, index, extraction.cleaned) } as Message };
      }

      // The question text is removed before the SDK persists the message. The hidden custom message
      // is converted to a user message for the model, but the server filters it out of the UI.
      pi.sendMessage(
        {
          customType: RAW_QUESTION_ANSWER_CUSTOM_TYPE,
          content: [{ type: 'text', text: rawQuestionAnswerMessage(answers) }],
          display: false,
        },
        { triggerTurn: true, deliverAs: 'followUp' },
      );
      return { message: { ...message, content: replaceText(content, index, extraction.cleaned) } as Message };
    });
  };
}
