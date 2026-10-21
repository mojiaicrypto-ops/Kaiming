import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';

export interface ComposerProps {
  readonly busy: 'idle' | 'queued' | 'processing';
  readonly canStop: boolean;
  readonly disabled: boolean;
  readonly onSubmit: (text: string) => Promise<void>;
  readonly onStop: () => Promise<void>;
}

/**
 * The input line. Three behaviours are load-bearing and easy to lose in a rewrite:
 *  - Enter sends, Shift+Enter breaks the line, and an IME composition never sends (R11);
 *  - a failed submit puts the text back instead of losing the user's message (R10);
 *  - while the chief runs, STOP targets the current input and says what it keeps (R13/C-stop).
 */
export function Composer({ busy, canStop, disabled, onSubmit, onStop }: ComposerProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // A ref, not just the state: two Enter presses can arrive in the same task, before React has
  // re-rendered with `sending: true`, and both would then pass the guard.
  const inFlight = useRef(false);
  const [stopFailed, setStopFailed] = useState(false);
  // A successful STOP clears the mark: the button should not stay red from an older attempt.
  const clearStopFailure = (): void => setStopFailed(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // The composer keeps focus across turns: it is the only place the user types.
  useEffect(() => {
    if (disabled || typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 560px)').matches) return;
    if (document.activeElement === null || document.activeElement === document.body) areaRef.current?.focus();
  }, [disabled]);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (text === '' || inFlight.current || disabled) return;
    inFlight.current = true;
    setSending(true);
    try {
      await onSubmit(text);
      setDraft('');
    } catch {
      // onSubmit already surfaced the reason; the draft stays so nothing is lost.
    } finally {
      inFlight.current = false;
      setSending(false);
      areaRef.current?.focus();
    }
  };

  const placeholder =
    busy === 'processing' ? t('chat.composer.busy') : busy === 'queued' ? t('chat.composer.queued') : t('chat.composer.placeholder');

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <span className="pr">❯</span>
      <textarea
        ref={areaRef}
        rows={2}
        aria-label={t('aria.composer')}
        placeholder={placeholder}
        value={draft}
        disabled={disabled || sending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
        data-testid="composer"
      />
      <button type="submit" className="send" disabled={disabled || sending || draft.trim() === ''} title={t('chat.send')}>
        ↑
      </button>
      {busy !== 'idle' && (
        <button
          type="button"
          className={`send${stopFailed ? ' danger' : ''}`}
          title={canStop ? t('chat.stopTitle') : t('chat.hint.stop')}
          onClick={() => {
            clearStopFailure();
            void onStop().catch(() => setStopFailed(true));
          }}
          data-testid="stop"
        >
          {t('chat.stop')}
        </button>
      )}
    </form>
  );
}

export function DockHint({ busy }: { busy: 'idle' | 'queued' | 'processing' }) {
  const { t } = useI18n();
  return (
    <div className="hint">
      <span>{t('chat.hint.send')}</span>
      {busy !== 'idle' && <State kind="wait">{t('chat.hint.stop')}</State>}
    </div>
  );
}
