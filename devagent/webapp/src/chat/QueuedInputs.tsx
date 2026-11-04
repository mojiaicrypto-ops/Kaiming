import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import type { QueuedInput } from '../state/slot';

export interface QueuedInputsProps {
  readonly inputs: readonly QueuedInput[];
  readonly onWithdraw: (inputId: string) => Promise<void>;
}

/**
 * Retained inputs: a message the user sent while a Task owned the session. It is a real message,
 * so hiding it would look like the message vanished; showing the user's own words and the reason
 * it waits, with a withdraw action, is the honest state (R8). The internal input id stays out of
 * the row: it identifies a record, not the message the reader wrote.
 */
export function QueuedInputs({ inputs, onWithdraw }: QueuedInputsProps) {
  const { t } = useI18n();
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  if (inputs.length === 0) return null;
  return (
    <div id="c-dock" data-testid="queued-inputs">
      {inputs.map((input) => {
        const text = input.text.trim();
        const images = input.imageCount > 0 ? t('queue.images', { count: input.imageCount }) : '';
        const preview = text === '' ? images : text;
        return (
          <div className="queue" key={input.inputId}>
            <State kind="wait">{t('queue.queued')}</State>
            <span className="q ell" title={preview}>
              {preview}
            </span>
            {text !== '' && images !== '' && <span className="f3">{images}</span>}
            <span className="f3">{t('queue.afterStep')}</span>
            <button
              type="button"
              className="btn ghost"
              disabled={withdrawing === input.inputId}
              aria-busy={withdrawing === input.inputId}
              onClick={() => {
                if (withdrawing !== null) return;
                setWithdrawing(input.inputId);
                void onWithdraw(input.inputId)
                  .catch(() => undefined)
                  .finally(() => setWithdrawing(null));
              }}
            >
              {withdrawing === input.inputId ? t('queue.withdrawing') : t('queue.withdraw')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
