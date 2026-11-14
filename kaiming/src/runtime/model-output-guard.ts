/**
 * Model-output guard: structural bounds on a member run's report attempts.
 *
 * Two failure classes, both decided by structure (tool name, isError bit, counts) and never by the
 * shape of the model's text:
 *  - a streamed tool-argument buffer exceeding the hard size cap (the 11-12 incident reached
 *    108,832 characters of arguments) — the stream is aborted and the message discarded;
 *  - the result tool `agent_report` failing repeatedly. N consecutive error results (schema
 *    validation, provider truncation refusals, blocked oversized calls, tool errors) mean the run
 *    cannot deliver what its input exists to produce. The streak resets only when `agent_report`
 *    itself succeeds — successes of other tools interleaved between failures do not (the 11-13
 *    incident interleaved successful read/bash calls). At N the runner performs its one corrective
 *    turn and the streak restarts; N further failures terminate the run as REPORT_RETRY_EXHAUSTED.
 *
 * Content-signature detection (repeated closing tags, repeated suffixes) was removed on
 * 2026-11-14: degenerate shapes are unbounded (the 11-13 variant used other tag names and an
 * 18–19 char repeat unit the 11-12 signatures could not see), and the per-delta regex analysis
 * was itself a CPU hazard. Only O(1) counters remain on the streaming path.
 *
 * Instance model: the registry reuses one Pi instance across inputs and does not reinstall
 * extensions, so the extension here is a stateless bridge to the *active input's* guard (the
 * runner swaps it per input); all state lives on the guard the runner owns and feeds through its
 * own per-input event subscription.
 */
import type { ExtensionAPI, ExtensionFactory, MessageEndEvent, ToolCallEvent } from '@earendil-works/pi-coding-agent';

/** Hidden custom message used for the one bounded corrective turn. */
export const MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE = 'kaiming.model-output-correction';

/** The store's typed terminal code for a discarded model response. */
export const MODEL_OUTPUT_CORRUPTED = 'MODEL_OUTPUT_CORRUPTED';
/** The store's typed terminal code for a report the member could not deliver within the budget. */
export const REPORT_RETRY_EXHAUSTED = 'REPORT_RETRY_EXHAUSTED';

export type ModelOutputFaultCode = typeof MODEL_OUTPUT_CORRUPTED | typeof REPORT_RETRY_EXHAUSTED;

export interface ModelOutputFault {
  readonly code: ModelOutputFaultCode;
  readonly detail: string;
}

/** A malformed argument string larger than this is not a normal tool call. */
const MAX_TOOL_ARGUMENT_CHARS = 1_048_576;
/** A report body is user-visible prose, not a log container; this is the report tool's policy. */
const REPORT_ARGUMENT_CHARS = 16_384;
/** Total streamed tool-argument characters above this is not a normal call; abort mid-stream. */
const MAX_STREAM_ARGUMENT_CHARS = 1_048_576;
/** Consecutive failed report attempts after which the runner performs its one corrective turn. */
export const REPORT_FAILURE_LIMIT = 5;
/** The result tool whose repeated failures the ledger counts. */
const REPORT_TOOL = 'agent_report';

/**
 * Which success resets the failure streak. `same-tool` is the shipped rule; `any-success` exists
 * only for the checker self-test: fed the 11-13 incident sequence (successful read/bash calls
 * interleaved between report failures), it never trips, which proves the rule matters.
 */
export type ReportStreakReset = 'same-tool' | 'any-success';

export function toolArgumentLimit(toolName: string): number {
  return toolName === REPORT_TOOL ? REPORT_ARGUMENT_CHARS : MAX_TOOL_ARGUMENT_CHARS;
}

/** First text snippet of a toolResult's content, flattened and bounded, as fault evidence. */
function firstErrorSnippet(content: unknown): string {
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (typeof block !== 'object' || block === null || !('text' in block)) continue;
    const text = block.text;
    if (typeof text !== 'string' || text.trim() === '') continue;
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
  }
  return '';
}

export class ModelOutputGuard {
  fault: ModelOutputFault | undefined;
  retryUsed = false;
  private readonly resetOn: ReportStreakReset;
  private readonly streamLengths = new Map<string, number>();
  private reportFailures = 0;

  constructor(options?: { readonly resetOn?: ReportStreakReset }) {
    this.resetOn = options?.resetOn ?? 'same-tool';
  }

  /**
   * Feed one session event. Returns true when the run must be aborted now: either a streamed
   * tool-argument buffer crossed the hard cap, or the report failure streak reached the limit.
   */
  observeEvent(event: unknown): boolean {
    if (typeof event !== 'object' || event === null || !('type' in event)) return false;
    if (event.type === 'message_start') {
      if (this.assistantMessageOf(event) !== undefined) this.streamLengths.clear();
      return false;
    }
    if (event.type === 'message_update') {
      if (!('assistantMessageEvent' in event)) return false;
      const delta = event.assistantMessageEvent;
      if (typeof delta !== 'object' || delta === null || !('delta' in delta)) return false;
      if (delta.delta === undefined || typeof delta.delta !== 'string') return false;
      if (!('type' in delta) || (delta.type !== 'toolcall_delta' && delta.type !== 'tool_call_delta')) return false;
      const index = 'contentIndex' in delta && typeof delta.contentIndex === 'number' ? delta.contentIndex : 0;
      const key = `tool:${String(index)}`;
      const seen = (this.streamLengths.get(key) ?? 0) + delta.delta.length;
      this.streamLengths.set(key, seen);
      if (seen > MAX_STREAM_ARGUMENT_CHARS && this.fault === undefined) {
        this.fault = { code: MODEL_OUTPUT_CORRUPTED, detail: 'tool arguments exceeded the streaming size limit' };
        return true;
      }
      return false;
    }
    if (event.type === 'message_end') {
      const message = this.toolResultOf(event);
      if (message === undefined) return false;
      if (message.toolName !== REPORT_TOOL) {
        if (this.resetOn === 'any-success' && message.isError === false) this.reportFailures = 0;
        return false;
      }
      if (message.isError !== true) {
        this.reportFailures = 0;
        return false;
      }
      this.reportFailures += 1;
      if (this.reportFailures >= REPORT_FAILURE_LIMIT && this.fault === undefined) {
        this.fault = {
          code: REPORT_RETRY_EXHAUSTED,
          detail: `agent_report failed ${String(this.reportFailures)} consecutive times (limit ${String(REPORT_FAILURE_LIMIT)}); last error: ${firstErrorSnippet(message.content)}`,
        };
        return true;
      }
    }
    return false;
  }

  /**
   * Decision for the extension's tool_call handler: block non-object arguments (recording a
   * fault) and calls over the per-tool argument policy. An oversized call is blocked WITHOUT a
   * fault — its error result feeds the report ledger like every other failure: one mechanism.
   */
  checkToolCall(toolName: string, input: unknown): { readonly block: boolean; readonly reason?: string } {
    if (this.fault !== undefined) {
      return { block: true, reason: 'the model output was already discarded as degenerate' };
    }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      this.fault = { code: MODEL_OUTPUT_CORRUPTED, detail: 'tool arguments are not a JSON object' };
      return { block: true, reason: 'tool arguments must be a JSON object; use valid JSON' };
    }
    const text = JSON.stringify(input);
    const limit = toolArgumentLimit(toolName);
    if (text.length > limit) {
      return {
        block: true,
        reason: `tool arguments are ${String(text.length)} characters; the ${toolName} limit is ${String(limit)}. Keep the result concise and put logs in paths, not the body.`,
      };
    }
    return { block: false };
  }

  /** The corrective turn starts a fresh report budget; the runner calls this once per input. */
  resetReportStreak(): void {
    this.reportFailures = 0;
  }

  /** Replacement content for an assistant message the guard discarded, so history stays clean. */
  replacementText(): string {
    return `[host] The previous model output was discarded: ${this.fault?.detail ?? 'malformed'}. Use the tool's required JSON arguments and keep the result concise.`;
  }

  /** The `message` of a session event, when it is an assistant message (narrowed, not cast). */
  private assistantMessageOf(event: object): unknown {
    if (!('message' in event) || typeof event.message !== 'object' || event.message === null) return undefined;
    const message = event.message;
    if (!('role' in message) || message.role !== 'assistant') return undefined;
    return message;
  }

  /** The `message` of a session event, when it is a toolResult message (narrowed, not cast). */
  private toolResultOf(event: object): { toolName: string; isError: boolean; content: unknown } | undefined {
    if (!('message' in event) || typeof event.message !== 'object' || event.message === null) return undefined;
    const message = event.message;
    if (!('role' in message) || message.role !== 'toolResult') return undefined;
    if (!('toolName' in message) || !('isError' in message)) return undefined;
    return {
      toolName: typeof message.toolName === 'string' ? message.toolName : '',
      isError: message.isError === true,
      content: 'content' in message ? message.content : undefined,
    };
  }
}

/**
 * The per-instance extension bridge. The registry reuses a Pi instance across inputs without
 * reinstalling extensions, so handlers resolve the *active* input's guard on every event instead
 * of closing over one input's state.
 */
export function createModelOutputGuardExtension(active: () => ModelOutputGuard | undefined): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    pi.on('tool_call', (event: ToolCallEvent) => {
      const guard = active();
      if (guard === undefined) return undefined;
      const decision = guard.checkToolCall(event.toolName, event.input);
      return decision.block
        ? { block: true, ...(decision.reason !== undefined ? { reason: decision.reason } : {}) }
        : undefined;
    });
    pi.on('message_end', (event: MessageEndEvent) => {
      const guard = active();
      if (guard === undefined || guard.fault === undefined) return undefined;
      const message = event.message;
      if (message.role !== 'assistant') return undefined;
      // A guard fault means the in-flight content must not enter persistent history: replace the
      // whole malformed message so it cannot poison the corrective turn. The replacement is
      // structurally the same assistant message with one text block; the SDK's message union
      // cannot express that narrowing from a literal, so this is the boundary's one unchecked
      // shape, assigned to a named constant.
      const replaced: MessageEndEvent['message'] = {
        ...message,
        content: [{ type: 'text', text: guard.replacementText() }],
      };
      return { message: replaced };
    });
  };
}

/** True for the hidden corrective turn; the browser already has the terminal failure/notice. */
export function isHiddenModelOutputCorrectionEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null || !('type' in event)) return false;
  if (event.type !== 'message_start' && event.type !== 'message_end' && event.type !== 'message_update') return false;
  if (!('message' in event) || typeof event.message !== 'object' || event.message === null) return false;
  const message = event.message;
  if (!('role' in message) || message.role !== 'custom') return false;
  if (!('customType' in message) || message.customType !== MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE) return false;
  return true;
}
