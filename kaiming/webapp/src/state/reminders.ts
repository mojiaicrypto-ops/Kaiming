/**
 * Reminder decisions for the chat page: a finished turn and a newly waiting question.
 *
 * Detection is a pure diff of two session snapshots. The hook that displays the result only runs
 * after the first snapshot has been recorded, so opening a session with a question already waiting
 * does not replay a reminder the user has not seen change; switching sessions starts a new baseline
 * for the same reason.
 */
import { useEffect, useRef } from 'react';
import type { SessionActivity, PendingInteraction } from '../api/stream';
import type { SessionSlot } from './slot';
import { useI18n } from '../i18n/I18nProvider';
import { toast } from '../lib/toast';
import { showBrowserNotification } from '../lib/notifications';

export interface ReminderSnapshot {
  readonly sessionId: string;
  readonly busy: SessionActivity;
  readonly pending: ReadonlySet<string>;
}

export type ReminderEvent =
  | { readonly kind: 'turn-complete' }
  | { readonly kind: 'question'; readonly count: number };

/**
 * What changed between two snapshots. A new question wins over a completion in the same tick: the
 * turn may have ended because it is now waiting for the user, and one reminder is enough. `queued`
 * and `stopping` are not "processing", so a canceled queue or a user stop does not look complete.
 */
export function reminderEvents(previous: ReminderSnapshot, current: ReminderSnapshot): ReminderEvent[] {
  if (previous.sessionId !== current.sessionId) return [];
  const newQuestions = [...current.pending].filter((id) => !previous.pending.has(id));
  if (newQuestions.length > 0) return [{ kind: 'question', count: newQuestions.length }];
  if (previous.busy === 'processing' && current.busy === 'idle' && current.pending.size === 0) {
    return [{ kind: 'turn-complete' }];
  }
  return [];
}

/** Pending interactions that are still waiting for an answer; answered cards are echoes, not work. */
function openPending(pending: readonly PendingInteraction[]): ReadonlySet<string> {
  return new Set(
    pending
      .filter((entry) => entry.resolved !== true)
      .map((entry) => entry.interactionId),
  );
}

export interface SessionRemindersOptions {
  readonly sessionId: string | null;
  readonly slot: SessionSlot;
  readonly active: boolean;
  /** The chat transcript is the visible screen, not merely the current route. */
  readonly onScreen: boolean;
  /** Focus/activate the chat screen when the user clicks a browser notification. */
  readonly onActivate: () => void;
}

/**
 * Display the reminders for one chief session. In-page when the user is looking at chat; a browser
 * notification when the window is hidden, unfocused, or the user is on another workbench screen.
 */
export function useSessionReminders(options: SessionRemindersOptions): void {
  const { t } = useI18n();
  const previous = useRef<ReminderSnapshot | null>(null);

  useEffect(() => {
    if (!options.active || options.sessionId === null) {
      previous.current = null;
      return;
    }
    const next: ReminderSnapshot = {
      sessionId: options.sessionId,
      busy: options.slot.busy,
      pending: openPending(options.slot.pending),
    };
    const before = previous.current;
    previous.current = next;
    if (before === null || before.sessionId !== next.sessionId) return;

    for (const event of reminderEvents(before, next)) {
      const text =
        event.kind === 'question'
          ? event.count === 1
            ? t('reminder.question')
            : t('reminder.questions', { count: event.count })
          : t('reminder.turnComplete');
      const crossWindow =
        !options.onScreen ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus();
      const shown = crossWindow && showBrowserNotification({
        title: t('brand.name'),
        body: text,
        tag: `kaiming:${options.sessionId}:${event.kind}`,
        onClick: options.onActivate,
      });
      if (!shown) {
        toast(text, event.kind === 'question' ? 'info' : 'success');
      }
    }
  }, [options.active, options.sessionId, options.slot.busy, options.slot.pending, options.onScreen, options.onActivate, t]);
}
