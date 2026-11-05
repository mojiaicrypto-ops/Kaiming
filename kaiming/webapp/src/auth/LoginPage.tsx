import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { RpcClient } from '../api/rpc';

export interface LoginPageProps {
  readonly rpc: RpcClient;
  readonly onSuccess: () => void;
}

/**
 * The access-password gate. It is the only screen allowed before a cookie exists, and it never
 * pretends a wrong password worked: the error stays until the next attempt.
 */
export function LoginPage({ rpc, onSuccess }: LoginPageProps) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (password === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.login(password);
      onSuccess();
    } catch {
      setError(t('auth.wrong'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form
        className="dlg"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2>❯ Kaiming</h2>
        <p>{t('auth.intro')}</p>
        <input
          className="inp"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder={t('auth.placeholder')}
          aria-label={t('auth.title')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          data-testid="password"
        />
        {error !== null && <div className="err">{error}</div>}
        <div className="btns" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="btn pri" disabled={busy || password === ''} data-testid="login">
            {t('auth.login')}
          </button>
        </div>
      </form>
    </div>
  );
}
