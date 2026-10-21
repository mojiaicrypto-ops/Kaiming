import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { useConfig, type ProviderView } from './config-model';
import type { RpcClient } from '../api/rpc';

/**
 * Providers: every configured endpoint, what it offers, and whether a credential exists. The key
 * itself never travels — the server redacts it — so the only truthful statement here is
 * "configured"; there is no "show key" affordance because there is nothing to show.
 */
export function ProvidersPage({ rpc, projectId }: { rpc: RpcClient; projectId: string }) {
  const { t } = useI18n();
  const { config, failed, reload } = useConfig(rpc, projectId === '' ? undefined : projectId, 'chief');
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ provider: string; ok: boolean; detail: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ providerId: '', baseUrl: '', models: '', apiKey: '' });
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaveError(null);
    try {
      await rpc.call(
        'config.save',
        {
          expectedRevision: null,
          value: {
            kind: 'provider',
            providerId: draft.providerId.trim(),
            baseUrl: draft.baseUrl.trim(),
            models: draft.models
              .split(',')
              .map((id) => id.trim())
              .filter((id) => id !== '')
              .map((id) => ({ id })),
            ...(draft.apiKey.trim() === '' ? {} : { apiKey: draft.apiKey.trim() }),
          },
        },
        { requestId: `provider-${Date.now()}` },
      );
      setDraft({ providerId: '', baseUrl: '', models: '', apiKey: '' });
      setAdding(false);
      await reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const test = async (provider: ProviderView): Promise<void> => {
    setTesting(provider.providerId);
    try {
      const probed = await rpc.call<{ available: boolean; detail: string }>('config.test', {
        providerId: provider.providerId,
        modelId: provider.models[0]?.id ?? '',
        ...(projectId === '' ? {} : { projectId }),
      });
      setResult({ provider: provider.providerId, ok: probed.available, detail: probed.detail });
    } catch (error) {
      setResult({ provider: provider.providerId, ok: false, detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(null);
    }
  };

  return (
    <section className="set-pane scroll">
      <div className="set-in">
        <h1>{t('settings.providers')}</h1>
        <p className="f3">{t('settings.providersDesc')}</p>
        <div className="set-body" data-testid="providers">
          {failed && <div className="st block">{t('settings.readFailed')}</div>}
          {!failed && (config?.providers ?? []).length === 0 && <div className="f3">{t('settings.noProviders')}</div>}
          {(config?.providers ?? []).map((provider) => (
            <div className="prov" key={provider.providerId}>
              <span className="nm">
                {provider.providerId}{' '}
                {provider.credentialConfigured ? (
                  <State kind="done">{t('settings.configured')}</State>
                ) : (
                  <State kind="block">{t('settings.notConfigured')}</State>
                )}
              </span>
              <span className="meta">{provider.baseUrl}</span>
              <span className="meta">{provider.models.map((model) => model.id).join(' · ')}</span>
              <span className="act">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void test(provider)}
                  disabled={testing === provider.providerId}
                >
                  {testing === provider.providerId ? t('settings.testing') : t('settings.test')}
                </button>
              </span>
              {result !== null && result.provider === provider.providerId && (
                <span className="meta">
                  <State kind={result.ok ? 'done' : 'block'}>
                    {result.ok
                      ? t('settings.testOk', { name: provider.providerId })
                      : t('settings.testFailed', { name: provider.providerId, reason: result.detail })}
                  </State>
                </span>
              )}
            </div>
          ))}
          {adding ? (
            <div className="card-in">
              <div className="rl">
                <span>{t('settings.providerId')}</span>
                <input
                  className="inp"
                  value={draft.providerId}
                  onChange={(event) => setDraft({ ...draft, providerId: event.target.value })}
                  placeholder="openai"
                  data-testid="provider-id"
                />
                <span />
              </div>
              <div className="rl">
                <span>{t('settings.baseUrl')}</span>
                <input
                  className="inp"
                  value={draft.baseUrl}
                  onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                  data-testid="provider-base"
                />
                <span />
              </div>
              <div className="rl">
                <span>{t('settings.modelsList')}</span>
                <input
                  className="inp"
                  value={draft.models}
                  onChange={(event) => setDraft({ ...draft, models: event.target.value })}
                  placeholder="gpt-5, gpt-5-mini"
                  data-testid="provider-models"
                />
                <span />
              </div>
              <div className="rl">
                <span>{t('settings.apiKey')}</span>
                <input
                  className="inp"
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                  data-testid="provider-key"
                />
                <span className="src">{t('settings.apiKeyHint')}</span>
              </div>
              {saveError !== null && <div className="note st block">{saveError}</div>}
              <div className="btns">
                <button type="button" className="btn pri" onClick={() => void save()} data-testid="provider-save">
                  {t('common.save')}
                </button>
                <button type="button" className="btn ghost" onClick={() => setAdding(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="note">{t('settings.addProviderHint')}</div>
              <button type="button" className="btn" onClick={() => setAdding(true)} data-testid="add-provider">
                {t('settings.addProvider')}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
