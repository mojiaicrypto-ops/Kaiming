/**
 * Model-output degeneration guard (first phase).
 *
 * Two failure classes are handled here, without a provider adapter:
 *  - a stream that starts repeating closing tags or a suffix pattern long before the provider's
 *    output limit (the 108 KB `agent_report` incident was about 8 KB of report plus repeated
 *    `</invoke>`/`</function>`/`</v8>` tags);
 *  - a completed tool call whose arguments are non-object or exceed the tool's size policy. A
 *    provider's native XML/DSML is not parsed or repaired: unsupported protocol is an error.
 *
 * Unsupported provider formats are errors, never guesses: this guard does not parse XML/DSML into
 * JSON and does not repair side-effect tool arguments.
 */
import type { ExtensionAPI, ExtensionFactory, MessageEndEvent, ToolCallEvent } from '@earendil-works/pi-coding-agent';

/** Hidden custom message used for the one bounded corrective turn. */
export const MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE = 'kaiming.model-output-correction';

/** The store's typed terminal code for a discarded model response. */
export const MODEL_OUTPUT_CORRUPTED = 'MODEL_OUTPUT_CORRUPTED';

export interface ModelOutputFault {
  readonly code: typeof MODEL_OUTPUT_CORRUPTED;
  readonly detail: string;
}

/** A malformed argument string larger than this is not a normal tool call. */
const MAX_TOOL_ARGUMENT_CHARS = 1_048_576;
/** A report body is user-visible prose, not a log container; this is the report tool's policy. */
const REPORT_ARGUMENT_CHARS = 16_384;
/** Total closing tags in one stream buffer above this is a degeneration signature. */
const TEXT_CLOSE_TAG_LIMIT = 24;
const TOOL_CLOSE_TAG_LIMIT = 8;
/** Keep the rolling analysis local; a degeneration signature lives near the end of the stream. */
const MAX_ANALYSIS_CHARS = 16_384;
const MAX_STREAM_ARGUMENT_CHARS = 1_048_576;

const CLOSING_TAG_RUN = /(?:\s*<\/(?:invoke|function|parameter|v8)>){8,}/;
const CLOSING_TAG = /<\/(?:invoke|function|parameter|v8)>/gi;

function repeatedSuffix(text: string, minimumRepeats: number): string | undefined {
  for (let unitLength = 4; unitLength <= 16; unitLength += 1) {
    const unit = text.slice(-unitLength);
    if (unit.trim() === '') continue;
    let repeats = 0;
    for (let end = text.length; end >= unitLength; end -= unitLength) {
      if (text.slice(end - unitLength, end) !== unit) break;
      repeats += 1;
    }
    if (repeats >= minimumRepeats) {
      return `${JSON.stringify(unit.slice(0, 24))} repeated ${String(repeats)} times`;
    }
  }
  return undefined;
}

/**
 * Detect a stream that has started to repeat itself. `kind` selects the threshold: a tool argument
 * is much less likely to legitimately contain many closing tags than prose/code text.
 */
export function degenerationReason(text: string, kind: 'text' | 'tool'): string | undefined {
  if (text === '') return undefined;
  const run = CLOSING_TAG_RUN.exec(text);
  if (run !== null) {
    return `repeated closing tags (${String(run[0].length)} characters in one run)`;
  }
  const closeCount = (text.match(CLOSING_TAG) ?? []).length;
  if (closeCount >= (kind === 'tool' ? TOOL_CLOSE_TAG_LIMIT : TEXT_CLOSE_TAG_LIMIT)) {
    return `repeated closing tags (${String(closeCount)} occurrences)`;
  }
  const suffix = repeatedSuffix(text, kind === 'tool' ? 8 : 16);
  if (suffix !== undefined) {
    return `repeated suffix ${suffix}`;
  }
  return undefined;
}

/** The per-tool argument policy. Unknown tools get the general backstop. */
export function toolArgumentLimit(toolName: string): number {
  return toolName === 'agent_report' ? REPORT_ARGUMENT_CHARS : MAX_TOOL_ARGUMENT_CHARS;
}

/**
 * One guard per run. The runner reads `fault` after each prompt and performs at most one corrective
 * turn; the extension never retries by itself.
 */
export class ModelOutputGuard {
  fault: ModelOutputFault | undefined;
  retryUsed = false;
  private readonly buffers = new Map<string, string>();
  private readonly lengths = new Map<string, number>();
  readonly extension: ExtensionFactory;

  constructor() {
    const extension = (pi: ExtensionAPI): void => {
      pi.on('message_start', (event) => {
        if (event.message.role === 'assistant') {
          this.buffers.clear();
          this.lengths.clear();
        }
      });

      pi.on('message_update', (event, ctx) => {
        if (this.fault !== undefined) return;
        const delta = (event as { assistantMessageEvent?: { type?: unknown; delta?: unknown; contentIndex?: unknown } })
          .assistantMessageEvent;
        if (delta === undefined || typeof delta.delta !== 'string') return;
        const type = delta.type;
        if (type !== 'text_delta' && type !== 'toolcall_delta' && type !== 'tool_call_delta') return;
        const index = typeof delta.contentIndex === 'number' ? delta.contentIndex : 0;
        const key = `${type}:${String(index)}`;
        const seen = (this.lengths.get(key) ?? 0) + delta.delta.length;
        this.lengths.set(key, seen);
        const next = `${this.buffers.get(key) ?? ''}${delta.delta}`;
        if (type !== 'text_delta' && seen > MAX_STREAM_ARGUMENT_CHARS) {
          this.fault = { code: MODEL_OUTPUT_CORRUPTED, detail: 'tool arguments exceeded the streaming size limit' };
          try {
            ctx.abort();
          } catch {
            // The stream may already be aborting; the fault is still recorded for the runner.
          }
          return;
        }
        const bounded = next.length > MAX_ANALYSIS_CHARS ? next.slice(-MAX_ANALYSIS_CHARS) : next;
        this.buffers.set(key, bounded);
        const reason = degenerationReason(bounded, type === 'text_delta' ? 'text' : 'tool');
        if (reason !== undefined) {
          this.fault = { code: MODEL_OUTPUT_CORRUPTED, detail: reason };
          // Stop the provider stream now, rather than waiting for the output-token ceiling.
          try {
            ctx.abort();
          } catch {
            // The stream may already be aborting; the fault is still recorded for the runner.
          }
        }
      });

      pi.on('tool_call', (event: ToolCallEvent) => {
        if (this.fault !== undefined) {
          return { block: true, reason: 'the model output was already discarded as degenerate' };
        }
        const input = event.input as unknown;
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
          this.fault = { code: MODEL_OUTPUT_CORRUPTED, detail: 'tool arguments are not a JSON object' };
          return { block: true, reason: 'tool arguments must be a JSON object; use valid JSON' };
        }
        const text = JSON.stringify(input);
        const limit = toolArgumentLimit(event.toolName);
        if (text.length > limit) {
          return {
            block: true,
            reason: `tool arguments are ${String(text.length)} characters; the ${event.toolName} limit is ${String(limit)}. Keep the result concise and put logs in paths, not the body.`,
          };
        }
        return undefined;
      });

      pi.on('message_end', (event) => {
        const message = event.message;
        if (message.role !== 'assistant' || this.fault === undefined) return undefined;
        // A stream abort means no tool call in this message was allowed to execute (they come after
        // message_end). Replace the whole malformed message so it cannot poison the corrective turn.
        return {
          message: {
            ...message,
            content: [
              {
                type: 'text',
                text: `[host] The previous model output was discarded as degenerate or malformed: ${this.fault.detail}. Do not repeat it. Use the tool's required JSON arguments and keep the result concise.`,
              },
            ],
          } as MessageEndEvent['message'],
        };
      });
    };
    this.extension = extension;
  }
}

/** True for the hidden corrective turn; the browser already has the terminal failure/notice. */
export function isHiddenModelOutputCorrectionEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false;
  const record = event as { type?: unknown; message?: { role?: unknown; customType?: unknown } };
  if (record.type !== 'message_start' && record.type !== 'message_end' && record.type !== 'message_update') {
    return false;
  }
  return record.message?.role === 'custom' && record.message?.customType === MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE;
}
