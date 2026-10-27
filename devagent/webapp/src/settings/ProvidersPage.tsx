import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { useCatalog, useConfig, type ProviderView } from './config-model';
import { ProviderForm, APIS } from './ProviderForm';
import type { RpcClient } from '../api/rpc';
import { errorText } from '../lib/errors';

/**
 * Providers: every configured endpoint, what it offers, whether a credential exists, and which
 * protocol it speaks. The key itself never travels — the server redacts it — so the only truthful
 * statement here is "configured"; there is no "show key" affordance because there is nothing to show.
 */
export function ProvidersPage({
  rpc,
  projectId,
  onSaved,
}: {
  rpc: RpcClient;
  projectId: string;
  /** The page's own confirmation channel; the shell already owns where "saved" appears. */
  onSaved: (message: string) => void;
}) {
  const { t } = useI18n();
  const { config, failed, reload } = useConfig(rpc, projectId === '' ? undefined : projectId, 'chief');
  const catalog = useCatalog(rpc);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ provider: string; ok: boolean; detail: string } | null>(null);
  /** The provider being added (null id) or edited (that id); nothing open means no dialog. */
  const [editing, setEditing] = useState<{ providerId: string | null; revision: number | null } | null>(null);

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
      setResult({ provider: provider.providerId, ok: false, detail: errorText(error, t) });
    } finally {
      setTesting(null);
    }
  };

  const apiLabel = (api: string | null): string => {
    if (api === null || api === '') return t('settings.api');
    const known = APIS.find((entry) => entry === api);
    return known === undefined ? api : t(`settings.api.${known}` as Parameters<typeof t>[0]);
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
                {provider.name}{' '}
                {provider.credentialConfigured ? (
                  <State kind="done">{t('settings.configured')}</State>
                ) : (
                  <State kind="block">{t('settings.notConfigured')}</State>
                )}
              </span>
              <span className="meta">
                {provider.providerId} · {apiLabel(provider.api)}
              </span>
              <span className="meta">{provider.baseUrl}</span>
              <span className="meta">{provider.models.map((model) => model.id).join(' · ')}</span>
              <span className="act">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setEditing({ providerId: provider.providerId, revision: provider.revision })}
                  data-testid="provider-edit"
                >
                  {t('settings.edit')}
                </button>
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
                      ? t('settings.testOk', { name: provider.name })
                      : t('settings.testFailed', { name: provider.name, reason: result.detail })}
                  </State>
                </span>
              )}
            </div>
          ))}
          <div className="note">{t('settings.addProviderHint')}</div>
          <button
            type="button"
            className="btn"
            onClick={() => setEditing({ providerId: null, revision: null })}
            data-testid="add-provider"
          >
            {t('settings.addProvider')}
          </button>
        </div>
      </div>
      {/*
        The editor is a dialog, not another block under the list: with a dozen providers the form used
        to open past the fold, so pressing "Edit" looked like nothing happened.
      */}
      {editing !== null && (
        <ProviderForm
          key={editing.providerId ?? 'new'}
          rpc={rpc}
          editing={editing}
          provider={(config?.providers ?? []).find((entry) => entry.providerId === editing.providerId)}
          catalog={catalog.models}
          onSaved={async (message) => {
            onSaved(message);
            await reload();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
