/**
 * Host UI adapter for a browser-hosted product.
 *
 * The product forwards confirm/select/input to the browser through its own request/answer channel
 * (WAL + chief channel in the full design). Everything TUI-only is either a harmless no-op or a
 * hard error, because this host never renders Pi's terminal UI.
 *
 * IMPORTANT — shape requirement (measured on Pi 1.0.0): `session.bindExtensions` wraps the given
 * uiContext with `{ ...ui, select, confirm, input, editor, custom }`. Object spread copies only own
 * enumerable properties, so a **class instance loses every prototype method** and `ctx.ui.notify`
 * becomes undefined. The adapter must therefore be a plain object literal, which is what this
 * factory returns.
 */
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  Theme,
} from '@earendil-works/pi-coding-agent';

export type UiMethod = 'confirm' | 'select' | 'input';

export interface UiRequest {
  readonly interactionId: string;
  readonly method: UiMethod;
  readonly title: string;
  readonly message?: string;
  readonly options?: readonly string[];
  readonly placeholder?: string;
}

export type ScriptedAnswer =
  | { readonly kind: 'confirm'; readonly value: boolean }
  | { readonly kind: 'select'; readonly value: string | undefined }
  | { readonly kind: 'input'; readonly value: string | undefined };

export interface HostUiAdapter extends ExtensionUIContext {
  /** Every confirm/select/input the SDK asked for, with the host-assigned interactionId. */
  readonly requests: UiRequest[];
  /** Notifications the SDK or a tool sent to the user. */
  readonly notifications: string[];
  /** interactionId of the most recent request, read by the ported question tool. */
  lastInteractionId(): string;
}

const TUI_ONLY = 'the browser host has no Pi TUI surface';

/**
 * @param answers scripted replies, consumed in call order (a missing answer means "cancelled").
 * @param delayMs holds each interaction open briefly, so a caller can observe the pending state.
 */
export function createHostUi(answers: readonly ScriptedAnswer[], delayMs = 0): HostUiAdapter {
  const requests: UiRequest[] = [];
  const notifications: string[] = [];
  const queue = [...answers];
  let answerIndex = 0;
  let sequence = 0;

  const record = (
    method: UiMethod,
    fields: {
      title: string;
      message?: string;
      options?: readonly string[];
      placeholder?: string;
    },
  ): void => {
    sequence += 1;
    requests.push({ interactionId: `q-${sequence}`, method, ...fields });
  };

  const nextAnswer = (): ScriptedAnswer | undefined => {
    const answer = queue[answerIndex];
    answerIndex += 1;
    return answer;
  };

  const hold = async (): Promise<void> => {
    if (delayMs > 0) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delayMs);
      await promise;
    }
  };

  const tuiOnly = (member: string): never => {
    throw new Error(`${member}: ${TUI_ONLY}`);
  };

  return {
    requests,
    notifications,
    lastInteractionId: () => requests[requests.length - 1]?.interactionId ?? 'none',

    async confirm(
      title: string,
      message: string,
      _opts?: ExtensionUIDialogOptions,
    ): Promise<boolean> {
      record('confirm', { title, message });
      await hold();
      const answer = nextAnswer();
      return answer?.kind === 'confirm' ? answer.value : false; // cancel ⇒ false
    },

    async select(
      title: string,
      options: string[],
      _opts?: ExtensionUIDialogOptions,
    ): Promise<string | undefined> {
      record('select', { title, options });
      await hold();
      const answer = nextAnswer();
      return answer?.kind === 'select' ? answer.value : undefined; // cancel ⇒ undefined
    },

    async input(
      title: string,
      placeholder?: string,
      _opts?: ExtensionUIDialogOptions,
    ): Promise<string | undefined> {
      record('input', { title, ...(placeholder !== undefined ? { placeholder } : {}) });
      await hold();
      const answer = nextAnswer();
      return answer?.kind === 'input' ? answer.value : undefined; // cancel ⇒ undefined
    },

    notify(message: string, _type?: 'info' | 'warning' | 'error'): void {
      notifications.push(message);
    },

    // Display-only TUI hints: harmless to receive, simply have no effect in a browser host.
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},

    // Terminal-only surfaces: fail loudly instead of pretending a terminal exists.
    custom: async (..._args: unknown[]): Promise<never> => tuiOnly('custom()'),
    editor: async (..._args: unknown[]): Promise<never> => tuiOnly('editor()'),
    pasteToEditor: (..._args: unknown[]): never => tuiOnly('pasteToEditor()'),
    setEditorText: (..._args: unknown[]): never => tuiOnly('setEditorText()'),
    getEditorText: (..._args: unknown[]): never => tuiOnly('getEditorText()'),
    addAutocompleteProvider: (..._args: unknown[]): never =>
      tuiOnly('addAutocompleteProvider()'),
    setEditorComponent: (..._args: unknown[]): never => tuiOnly('setEditorComponent()'),
    getEditorComponent: () => undefined,
    getAllThemes: (..._args: unknown[]): never => tuiOnly('getAllThemes()'),
    getTheme: (..._args: unknown[]): never => tuiOnly('getTheme()'),
    setTheme: () => ({ success: false, error: TUI_ONLY }),

    // No Theme instance can be produced without the terminal theme machinery, and a throwing
    // getter would break bindExtensions (it spreads values). The value is deliberately absent and
    // PI-08 asserts that it is undefined at runtime, so nothing is silently pretended.
    theme: undefined as unknown as Theme,

    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
}