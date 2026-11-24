/**
 * The one visible consequence of a failed model run. It names the category, keeps the provider's
 * own words, and offers the settings route only for model failures: a Task or storage failure must
 * not send the reader to the wrong screen.
 *
 * It is not dismissible: the next submitted input is the only act that clears a terminal error,
 * because hiding a quota exhaustion would leave the user typing into a conversation that cannot run.
 */
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { catalogErrorKey } from './task-labels';
import type { InputErrorView } from '../api/stream';

export interface InputErrorNoticeProps {
  readonly error: InputErrorView | null;
  /** Present on the chat screen: quota/auth failures point at the settings screen. */
  readonly onOpenSettings?: (() => void) | undefined;
}

export function InputErrorNotice({ error, onOpenSettings }: InputErrorNoticeProps) {
  const { t } = useI18n();
  if (error === null) return null;
  const key = catalogErrorKey(error.code);
  const modelRelated = error.code.startsWith('MODEL_');
  return (
    <div className="bn block" role="alert" data-testid="input-error-banner">
      <State kind="block">
        {t('banner.runFailed')} · {key === null ? error.code : t(key)}
      </State>
      {error.message === '' ? undefined : <span className="f2">{error.message}</span>}
      <span className="sp" />
      {modelRelated && onOpenSettings !== undefined ? (
        <button type="button" className="btn ghost" onClick={onOpenSettings} data-testid="input-error-settings">
          {t('error.modelSettings')}
        </button>
      ) : undefined}
    </div>
  );
}
