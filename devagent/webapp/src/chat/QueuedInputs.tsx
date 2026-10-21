import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';

export interface QueuedInputsProps {
  readonly inputs: ReadonlyArray<{ readonly inputId: string; readonly status: string }>;
  readonly onWithdraw: (inputId: string) => Promise<void>;
}

/**
 * Retained inputs: a message the user sent while a Task owned the session. It is a real message,
 * so hiding it would look like the message vanished; showing it with a withdraw action is the
 * honest state (R8).
 */
export function QueuedInputs({ inputs, onWithdraw }: QueuedInputsProps) {
  const { t } = useI18n();
  if (inputs.length === 0) return null;
  return (
    <div id="c-dock" data-testid="queued-inputs">
      {inputs.map((input) => (
        <div className="queue" key={input.inputId}>
          <State kind="wait">{t('queue.queued')}</State>
          <span className="q ell mono">{input.inputId}</span>
          <span className="f3">{t('queue.afterStep')}</span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void onWithdraw(input.inputId);
            }}
          >
            {t('queue.withdraw')}
          </button>
        </div>
      ))}
    </div>
  );
}
