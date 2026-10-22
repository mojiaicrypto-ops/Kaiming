import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { MESSAGE_KEYS } from '../i18n/catalog';
import { State } from '../app/State';

export interface BannerProps {
  /** Inputs the host could not close. The banner states the fact; the chief decides what follows. */
  readonly interrupted: readonly { readonly inputId: string; readonly errorCode: string | null }[];
  readonly onAskChief: (text: string) => void;
  readonly onDismissInterrupted: () => void;
  readonly status: 'connecting' | 'connected' | 'reconnecting' | 'offline';
  readonly blocked: { readonly code: string; readonly detail: string } | null;
  readonly onDismissBlocked: () => void;
  readonly onRetry: () => void;
  readonly historyProblems: readonly string[];
}

/**
 * Banners are the only thing allowed to push the transcript down: a dropped connection, a blocked
 * run, and a history that could not be read completely. Everything else belongs in the status bar
 * or the transcript. Each banner states the consequence, not just the condition.
 */
export function Banner({
  interrupted,
  onAskChief,
  onDismissInterrupted,
  status,
  blocked,
  onDismissBlocked,
  onRetry,
  historyProblems,
}: BannerProps) {
  const { t } = useI18n();
  const items: ReactNode[] = [];

  if (status === 'reconnecting' || status === 'offline') {
    items.push(
      <div key="connection" className={`bn ${status === 'offline' ? 'block' : 'run'}`}>
        <State kind={status === 'offline' ? 'block' : 'run'}>
          {status === 'offline' ? t('shell.offline') : t('banner.reconnecting')}
        </State>
        <span className="f2">{t('banner.reconnectingDetail')}</span>
        <span className="sp" />
        <button type="button" className="btn ghost" onClick={onRetry}>
          {t('banner.retry')}
        </button>
      </div>,
    );
  }

  if (interrupted.length > 0) {
    // Not an error card and not a form: the surfaces below (a crash, an unconfirmed save) are facts
    // the program cannot judge, so the banner says what it knows and hands the decision to the chief.
    items.push(
      <div key="interrupted" className="bn block" data-testid="interrupted-banner">
        <State kind="paused">{t('recovery.title')}</State>
        <span className="f2">
          {t('recovery.detail', { count: interrupted.length })} {interrupted.map((entry) => entry.inputId).join(', ')}
        </span>
        <span className="sp" />
        <button
          type="button"
          className="btn pri"
          data-testid="recovery-ask"
          onClick={() => onAskChief(t('recovery.prompt', { ids: interrupted.map((entry) => entry.inputId).join(', ') }))}
        >
          {t('recovery.ask')}
        </button>
        <button type="button" className="btn ghost" onClick={onDismissInterrupted}>
          {t('recovery.ack')}
        </button>
      </div>,
    );
  }

  if (blocked !== null) {
    items.push(
      <div key="blocked" className="bn block">
        <State kind="block">
          {t('banner.blocked')} ·{' '}
          {/* A code we have no sentence for keeps its own name instead of showing a key. */}
          {MESSAGE_KEYS.includes(`error.${blocked.code}` as never)
            ? t(`error.${blocked.code}` as 'error.blocked_config')
            : blocked.code}
        </State>
        <span className="f2">{blocked.detail}</span>
        <span className="sp" />
        <button type="button" className="btn ghost" onClick={onDismissBlocked}>
          {t('banner.blockedAck')}
        </button>
      </div>,
    );
  }

  if (historyProblems.length > 0) {
    items.push(
      <div key="history" className="bn">
        <State kind="wait">{t('banner.historyProblems', { count: historyProblems.length })}</State>
        <details>
          <summary>{t('common.more')}</summary>
          <pre>{historyProblems.join('\n')}</pre>
        </details>
      </div>,
    );
  }

  if (items.length === 0) return null;
  return <div id="c-banner">{items}</div>;
}
