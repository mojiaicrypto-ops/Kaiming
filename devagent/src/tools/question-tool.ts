/**
 * Ported `question` tool: the browser-safe counterpart of the official TUI example.
 *
 * The official example builds a full-screen TUI component and refuses to run when `ctx.mode` is
 * not `tui`. The product needs the same three user decisions without a terminal, so this port maps
 * them onto the host's generic interaction methods (`ctx.ui.confirm/select/input`) and hands the
 * host-assigned interactionId back to the model in the tool result.
 */
import { type ToolDefinition } from '@earendil-works/pi-coding-agent';

export interface QuestionRequest {
  readonly method: 'confirm' | 'select' | 'input';
  readonly title: string;
  readonly message?: string;
  readonly options?: readonly string[];
  readonly placeholder?: string;
}

export type ParseResult = { readonly request: QuestionRequest } | { readonly error: string };

/** Runtime validation of model-provided tool arguments (never trusted as typed input). */
export function parseQuestionParams(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'params must be an object' };
  }
  // `typeof` above proves an object; indexing it by string keys is the supported narrowing idiom.
  const record = raw as Record<string, unknown>;
  const method = record['method'];
  if (method !== 'confirm' && method !== 'select' && method !== 'input') {
    return { error: 'method must be one of confirm/select/input' };
  }
  const title = record['title'];
  if (typeof title !== 'string' || title.length === 0) {
    return { error: 'title must be a non-empty string' };
  }
  const message = record['message'];
  const options = record['options'];
  const placeholder = record['placeholder'];
  const request: QuestionRequest = {
    method,
    title,
    ...(typeof message === 'string' ? { message } : {}),
    ...(Array.isArray(options) && options.every((item) => typeof item === 'string')
      ? { options }
      : {}),
    ...(typeof placeholder === 'string' ? { placeholder } : {}),
  };
  if (request.method === 'confirm' && request.message === undefined) {
    return { error: 'confirm requires message' };
  }
  if (request.method === 'select' && (request.options === undefined || request.options.length === 0)) {
    return { error: 'select requires a non-empty options array' };
  }
  return { request };
}

export interface QuestionDetails {
  readonly interactionId: string;
  readonly method: string;
  readonly answer: string | boolean | null;
  readonly hasUI: boolean;
  /** Sampled at tool entry, before the interaction is requested (NOT a during-wait sample). */
  readonly idleAtToolEntry: boolean | null;
  readonly error?: string;
}

/**
 * @param interactionIdOf reads the interactionId the host assigned to the most recent request.
 */
export function createQuestionTool(interactionIdOf: () => string): ToolDefinition {
  return {
    name: 'question',
    label: 'Question',
    description:
      'Ask the user a question through the host UI. method=confirm needs message; method=select needs options.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['confirm', 'select', 'input'] },
        title: { type: 'string' },
        message: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        placeholder: { type: 'string' },
      },
      required: ['method', 'title'],
      additionalProperties: false,
    },
    executionMode: 'sequential',
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      const parsed = parseQuestionParams(rawParams);
      if ('error' in parsed) {
        const details: QuestionDetails = {
          interactionId: 'none',
          method: 'none',
          answer: null,
          hasUI: ctx.hasUI,
          idleAtToolEntry: null,
          error: parsed.error,
        };
        return {
          content: [{ type: 'text', text: `Error: ${parsed.error}` }],
          details,
          isError: true,
        };
      }
      const request = parsed.request;
      if (!ctx.hasUI) {
        const details: QuestionDetails = {
          interactionId: 'none',
          method: request.method,
          answer: null,
          hasUI: false,
          idleAtToolEntry: null,
          error: 'UI not available: the host bound no UI adapter',
        };
        return {
          content: [
            {
              type: 'text',
              text: `Error: UI not available (mode=${ctx.mode}); the host must bind a UI adapter`,
            },
          ],
          details,
          isError: true,
        };
      }

      // Sampled while this tool owns the run (an interaction is about to be requested).
      const idleAtToolEntry = ctx.isIdle();
      let answer: string | boolean | undefined;
      if (request.method === 'confirm') {
        answer = await ctx.ui.confirm(request.title, request.message ?? '');
      } else if (request.method === 'select') {
        answer = await ctx.ui.select(request.title, [...(request.options ?? [])]);
      } else {
        answer = await ctx.ui.input(request.title, request.placeholder);
      }
      // UI-surface probes: `notify` must survive the SDK's uiContext wrapping (spread), the
      // terminal-only surface must fail with our own message, and the absent theme must stay absent.
      ctx.ui.notify(`question probe ${request.method}`);
      ctx.ui.setStatus('question-probe', 'ok');
      let tuiError = 'none';
      try {
        ctx.ui.getAllThemes();
        tuiError = 'no-throw';
      } catch (error) {
        tuiError = error instanceof Error ? error.message : String(error);
      }
      const themeAbsent = ctx.ui.theme === undefined;
      const interactionId = interactionIdOf();
      const details: QuestionDetails = {
        interactionId,
        method: request.method,
        answer: answer ?? null,
        hasUI: ctx.hasUI,
        idleAtToolEntry,
      };
      return {
        content: [
          {
            type: 'text',
            text: `interactionId=${interactionId} mode=${ctx.mode} hasUI=${ctx.hasUI} idleAtToolEntry=${idleAtToolEntry} notify=${typeof ctx.ui.notify === 'function' ? 'ok' : 'missing'} tuiError=${tuiError} themeAbsent=${themeAbsent} answer=${JSON.stringify(answer ?? null)}`,
          },
        ],
        details,
      };
    },
  };
}