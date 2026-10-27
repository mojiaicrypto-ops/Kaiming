import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { useCatalog, useConfig, type ProviderView } from './config-model';
import type { RpcClient } from '../api/rpc';
import { errorText } from '../lib/errors';

/**
 * The protocols this workbench offers, in the order they are shown. Values are Pi's own `api`
 * identifiers: the server refuses anything else, so a typo cannot become a provider that never
 * loads.
 */
const APIS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const;

/**
 * One model of the endpoint: the id Pi uses, whether it can reason, and — when the id is a gateway
 * alias — which catalogue model it really is.
 */
interface ModelDraft {
  id: string;
  reasoning: boolean;
  /** "provider/model" of the real model; empty when the id is the catalogue's own name. */
  baseModel: string;
}

/** The form's own state: the id is only editable while adding, so it is empty when editing. */
interface Draft {
  providerId: string;
  name: string;
  baseUrl: string;
  api: string;
  models: readonly ModelDraft[];
  apiKey: string;
}

const EMPTY: Draft = {
  providerId: '',
  name: '',
  baseUrl: '',
  api: 'openai-completions',
  models: [{ id: '', reasoning: false, baseModel: '' }],
  apiKey: '',
};

/**
 * Providers: every configured endpoint, what it offers, whether a credential exists, and which
 * protocol it speaks. The key itself never travels — the server redacts it — so the only truthful
 * statement here is "configured"; there is no "show key" affordance because there is nothing to show.
 */
export function ProvidersPage({ rpc, projectId }: { rpc: RpcClient; projectId: string }) {
  const { t } = useI18n();
  const { config, failed, reload } = useConfig(rpc, projectId === '' ? undefined : projectId, 'chief');
  const catalog = useCatalog(rpc);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ provider: string; ok: boolean; detail: string } | null>(null);
  /** The provider being added (null id) or edited (that id); nothing open means no form. */
  const [editing, setEditing] = useState<{ providerId: string | null; revision: number | null } | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openAdd = (): void => {
    setDraft(EMPTY);
    setSaveError(null);
    setEditing({ providerId: null, revision: null });
  };

  const openEdit = (provider: ProviderView): void => {
    setDraft({
      providerId: provider.providerId,
      name: provider.name,
      baseUrl: provider.baseUrl,
      // A provider saved before protocols were selectable has none stored: leave the choice to the
      // user instead of writing the default they never saw.
      api: provider.api ?? '',
      models:
        provider.models.length === 0
          ? [{ id: '', reasoning: false, baseModel: '' }]
          : provider.models.map((model) => ({
              id: model.id,
              reasoning: model.reasoning === true,
              baseModel:
                model.baseModel === undefined ? '' : `${model.baseModel.providerId}/${model.baseModel.modelId}`,
            })),
      apiKey: '',
    });
    setSaveError(null);
    setEditing({ providerId: provider.providerId, revision: provider.revision });
  };

  const close = (): void => {
    setEditing(null);
    setDraft(EMPTY);
    setSaveError(null);
  };

  const save = async (): Promise<void> => {
    if (editing === null) return;
    setSaveError(null);
    try {
      await rpc.call(
        'config.save',
        {
          expectedRevision: editing.revision,
          value: {
            kind: 'provider',
            providerId: draft.providerId.trim(),
            name: draft.name.trim(),
            baseUrl: draft.baseUrl.trim(),
            api: draft.api,
            // Only rows with an id travel: a blank row the user added but left empty is not a model.
            // The alias travels as text; the server resolves it and refuses a name the catalogue
            // does not know instead of writing numbers nobody checked.
            models: draft.models
              .map((model) => ({
                id: model.id.trim(),
                reasoning: model.reasoning,
                ...(model.baseModel.trim() === '' ? {} : { baseModel: model.baseModel.trim() }),
              }))
              .filter((model) => model.id !== ''),
            ...(draft.apiKey.trim() === '' ? {} : { apiKey: draft.apiKey.trim() }),
          },
        },
        { requestId: `provider-${Date.now()}` },
      );
      close();
      await reload();
    } catch (error) {
      setSaveError(errorText(error, t));
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
      setResult({ provider: provider.providerId, ok: false, detail: errorText(error, t) });
    } finally {
      setTesting(null);
    }
  };

  /** Token counts are read at a glance: "1M" and "131k", never "1000k". */
  const size = (count: number): string =>
    count >= 1_000_000
      ? `${(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`
      : `${String(Math.round(count / 1000))}k`;

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
                  onClick={() => openEdit(provider)}
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
          {editing !== null ? (
            <div className="card-in">
              <div className="f3" style={{ marginBottom: 'var(--s1)' }}>
                {editing.providerId === null ? t('settings.addProvider') : t('settings.editProvider')}
              </div>
              <div className="rl">
                <span>{t('settings.providerName')}</span>
                <input
                  className="inp"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder={draft.providerId === '' ? 'DeepSeek' : draft.providerId}
                  data-testid="provider-name"
                />
                <span className="src">{t('settings.providerNameHint')}</span>
              </div>
              <div className="rl">
                <span>{t('settings.providerId')}</span>
                <input
                  className="inp"
                  value={draft.providerId}
                  onChange={(event) => setDraft({ ...draft, providerId: event.target.value })}
                  placeholder="deepseek"
                  // The id is the key in models.json, the database and every assignment: renaming it
                  // is a migration, not an edit.
                  readOnly={editing.providerId !== null}
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
                <span>{t('settings.api')}</span>
                <select
                  className="inp"
                  value={draft.api}
                  onChange={(event) => setDraft({ ...draft, api: event.target.value })}
                  data-testid="provider-api"
                >
                  {draft.api === '' && <option value="">—</option>}
                  {APIS.map((api) => (
                    <option key={api} value={api}>
                      {apiLabel(api)}
                    </option>
                  ))}
                </select>
                <span className="src">{t('settings.apiHint')}</span>
              </div>
              <div className="rl models-row">
                <span>{t('settings.modelsList')}</span>
                <div className="model-rows" data-testid="provider-models">
                  {draft.models.map((model, index) => {
                    // The edited provider is excluded: its own ids are the aliases being named, and
                    // pointing an alias at itself would only record Pi's fallback values as facts.
                    const self = draft.providerId.trim();
                    const typed = model.baseModel.trim();
                    const alias = catalog.models.find(
                      (entry) => entry.providerId !== self && `${entry.providerId}/${entry.id}` === typed,
                    );
                    const suggestions = catalog.models
                      .filter((entry) => entry.providerId !== self)
                      .filter((entry) => `${entry.providerId}/${entry.id}`.toLowerCase().includes(typed.toLowerCase()))
                      .slice(0, 40);
                    const update = (patch: Partial<ModelDraft>): void =>
                      setDraft({
                        ...draft,
                        models: draft.models.map((entry, position) =>
                          position === index ? { ...entry, ...patch } : entry,
                        ),
                      });
                    return (
                      <div className="model-row" key={String(index)}>
                        <input
                          className="inp"
                          value={model.id}
                          placeholder="gpt-5, deepseek-reasoner…"
                          aria-label={t('settings.modelId')}
                          onChange={(event) => update({ id: event.target.value })}
                          data-testid="provider-model-id"
                        />
                        <input
                          className="inp alias"
                          value={model.baseModel}
                          list={`catalog-${String(index)}`}
                          placeholder={t('settings.modelAliasPlaceholder')}
                          aria-label={t('settings.modelAlias')}
                          title={t('settings.modelAliasHint')}
                          onChange={(event) => update({ baseModel: event.target.value })}
                          data-testid="provider-model-alias"
                        />
                        <datalist id={`catalog-${String(index)}`}>
                          {suggestions.map((entry) => (
                            <option key={`${entry.providerId}/${entry.id}`} value={`${entry.providerId}/${entry.id}`} />
                          ))}
                        </datalist>
                        {/* The alias decides the facts when it is set: a checkbox that the mapping
                            overrides would be a claim the run does not honour. */}
                        {typed === '' ? (
                          <label className="chk" title={t('settings.modelReasoningHint')}>
                            <input
                              type="checkbox"
                              checked={model.reasoning}
                              onChange={(event) => update({ reasoning: event.target.checked })}
                              data-testid="provider-model-reasoning"
                            />
                            {t('settings.modelReasoning')}
                          </label>
                        ) : (
                          <span
                            className={alias === undefined ? 'meta warn' : 'meta'}
                            title={alias === undefined ? t('settings.modelAliasUnknown') : typed}
                            data-testid="provider-model-alias-facts"
                          >
                            {alias === undefined
                              ? t('settings.modelAliasUnknown')
                              : [
                                  alias.reasoning ? t('settings.modelReasoning') : t('settings.level.unsupported'),
                                  `${t('settings.modelFactsCtx')} ${size(alias.contextWindow)}`,
                                  `${t('settings.modelFactsOut')} ${size(alias.maxTokens)}`,
                                ].join(' · ')}
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn ghost x"
                          aria-label={t('settings.modelRemove')}
                          title={t('settings.modelRemove')}
                          // One row always stays: an endpoint with no model is not a provider.
                          disabled={draft.models.length <= 1}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              models: draft.models.filter((_, position) => position !== index),
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="btn ghost add-model"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        models: [...draft.models, { id: '', reasoning: false, baseModel: '' }],
                      })
                    }
                    data-testid="provider-model-add"
                  >
                    {t('settings.modelAdd')}
                  </button>
                </div>
              </div>
              <div className="rl">
                <span>{t('settings.apiKey')}</span>
                <input
                  className="inp"
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                  placeholder={editing.providerId === null ? '' : '••••••'}
                  data-testid="provider-key"
                />
                <span className="src">{t('settings.apiKeyHint')}</span>
              </div>
              {saveError !== null && <div className="note st block">{saveError}</div>}
              <div className="btns">
                <button
                  type="button"
                  className="btn pri"
                  onClick={() => void save()}
                  disabled={draft.api === ''}
                  data-testid="provider-save"
                >
                  {t('common.save')}
                </button>
                <button type="button" className="btn ghost" onClick={close}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="note">{t('settings.addProviderHint')}</div>
              <button type="button" className="btn" onClick={openAdd} data-testid="add-provider">
                {t('settings.addProvider')}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
