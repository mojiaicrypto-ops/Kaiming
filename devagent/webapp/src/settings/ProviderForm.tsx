import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useFocusTrap } from '../app/focus';
import { errorText } from '../lib/errors';
import type { RpcClient } from '../api/rpc';
import { ModelPicker, keyOf } from './ModelPicker';
import type { CatalogModel, ProviderView } from './config-model';

/**
 * The protocols this workbench offers, in the order they are shown. Values are Pi's own `api`
 * identifiers: the server refuses anything else, so a typo cannot become a provider that never
 * loads.
 */
export const APIS = ['openai-completions', 'openai-responses', 'anthropic-messages'] as const;

/**
 * One model of the endpoint: the id Pi uses, and which catalogue model it really is (the picker's
 * "provider/model", empty when nothing was resolved).
 */
interface ModelDraft {
  id: string;
  reasoning: boolean;
  baseModel: string;
  /**
   * True while the id came from the picker. Focusing the id hands it back to the operator, because a
   * gateway that names its own models is the one case the id is not the catalogue's.
   */
  picked: boolean;
}

interface Draft {
  providerId: string;
  name: string;
  baseUrl: string;
  api: string;
  models: readonly ModelDraft[];
  apiKey: string;
}

const BLANK_MODEL: ModelDraft = { id: '', reasoning: false, baseModel: '', picked: false };

function draftFor(provider: ProviderView | undefined): Draft {
  if (provider === undefined) {
    return {
      providerId: '',
      name: '',
      baseUrl: '',
      api: 'openai-completions',
      models: [BLANK_MODEL],
      apiKey: '',
    };
  }
  return {
    providerId: provider.providerId,
    name: provider.name,
    baseUrl: provider.baseUrl,
    // A provider saved before protocols were selectable has none stored: leave the choice to the
    // user instead of writing the default they never saw.
    api: provider.api ?? '',
    models:
      provider.models.length === 0
        ? [BLANK_MODEL]
        : provider.models.map((model) => ({
            id: model.id,
            reasoning: model.reasoning === true,
            baseModel: model.upstream ?? '',
            picked: model.upstream !== undefined && model.upstream.endsWith(`/${model.id}`),
          })),
    apiKey: '',
  };
}

/**
 * The provider editor, as a dialog.
 *
 * It is a dialog because the list it edits can be long: the form used to sit below every row, so
 * "Edit" on the first of a dozen providers looked like a no-op — the form opened past the fold. A
 * dialog also gets the focus trap and Escape for free, which an inline form never had.
 *
 * The form is the whole declaration of one endpoint: where it is, which protocol it speaks, which
 * models it offers, and the key. Model facts come from the picker; nothing here asks the user to
 * restate what Pi's catalogue already knows.
 */
export function ProviderForm({
  rpc,
  editing,
  provider,
  catalog,
  onSaved,
  onClose,
}: {
  rpc: RpcClient;
  /** `providerId: null` creates one; otherwise this provider is edited against its revision. */
  editing: { readonly providerId: string | null; readonly revision: number | null };
  /** The stored provider being edited, or undefined when adding. */
  provider: ProviderView | undefined;
  catalog: readonly CatalogModel[];
  onSaved: (message: string) => Promise<void> | void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => draftFor(provider));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  useFocusTrap(panel);

  // Escape closes, as it does everywhere else in this shell. A save in flight is the one exception:
  // the answer must be seen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const update = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }));

  const setModel = (index: number, patch: Partial<ModelDraft>): void =>
    setDraft((current) => ({
      ...current,
      models: current.models.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    }));

  const save = async (): Promise<void> => {
    setSaveError(null);
    setSaving(true);
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
            // The catalogue reference travels as `baseModel`; the server resolves it and refuses a
            // name the catalogue does not know instead of writing numbers nobody checked.
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
      onClose();
      await onSaved(t('settings.saved'));
    } catch (error) {
      // The dialog stays open with the reason inline: the form is the only place the fix can happen.
      setSaveError(errorText(error, t));
    } finally {
      setSaving(false);
    }
  };

  const apiLabel = (api: string): string => {
    const known = APIS.find((entry) => entry === api);
    return known === undefined ? api : t(`settings.api.${known}` as Parameters<typeof t>[0]);
  };

  const adding = editing.providerId === null;
  const self = draft.providerId.trim();

  return (
    <div className="scrim" onClick={() => (saving ? undefined : onClose())} role="presentation">
      <div
        ref={panel}
        tabIndex={-1}
        className="dlg provider-dlg"
        role="dialog"
        aria-modal="true"
        aria-label={adding ? t('settings.addProvider') : t('settings.editProvider')}
        onClick={(event) => event.stopPropagation()}
        data-testid="provider-form"
      >
        <div className="dlg-h">
          <h2>{adding ? t('settings.addProvider') : t('settings.editProvider')}</h2>
          {!adding && <span className="meta">{draft.providerId}</span>}
        </div>
        <div className="dlg-b">
          <div className="rl">
            <span>{t('settings.providerName')}</span>
            <input
              className="inp"
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
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
              onChange={(event) => update({ providerId: event.target.value })}
              placeholder="deepseek"
              // The id is the key in models.json, the database and every assignment: renaming it is
              // a migration, not an edit.
              readOnly={!adding}
              data-testid="provider-id"
            />
            <span />
          </div>
          <div className="rl">
            <span>{t('settings.baseUrl')}</span>
            <input
              className="inp"
              value={draft.baseUrl}
              onChange={(event) => update({ baseUrl: event.target.value })}
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
              onChange={(event) => update({ api: event.target.value })}
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
              {draft.models.map((model, index) => (
                <div className="model-row" key={String(index)}>
                  {/*
                    One control per model, not three: choosing from the catalogue is the whole
                    declaration (protocol, reasoning, levels, limits). The id box stays for a gateway
                    that invented its own name; leave it empty and the catalogue name is used.
                  */}
                  <input
                    className="inp"
                    readOnly={model.picked}
                    value={model.id}
                    placeholder={t('settings.modelIdPlaceholder')}
                    aria-label={t('settings.modelId')}
                    title={model.picked ? t('settings.modelIdFromPicker') : undefined}
                    onChange={(event) => setModel(index, { id: event.target.value, picked: false })}
                    onFocus={() => {
                      if (model.picked) setModel(index, { picked: false });
                    }}
                    data-testid="provider-model-id"
                  />
                  <ModelPicker
                    models={catalog}
                    value={model.baseModel}
                    excludeProvider={self}
                    placeholder={t('settings.modelPickerPlaceholder')}
                    onChange={(chosen) =>
                      setModel(index, {
                        baseModel: chosen === null ? '' : keyOf(chosen),
                        reasoning: chosen?.reasoning === true,
                        // A gateway id already typed stays; only the facts are borrowed.
                        ...(chosen === null || model.id.trim() !== '' ? {} : { id: chosen.id, picked: true }),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="btn ghost x"
                    aria-label={t('settings.modelRemove')}
                    title={t('settings.modelRemove')}
                    // One row always stays: an endpoint with no model is not a provider.
                    disabled={draft.models.length <= 1}
                    onClick={() =>
                      update({ models: draft.models.filter((_, position) => position !== index) })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn ghost add-model"
                onClick={() => update({ models: [...draft.models, BLANK_MODEL] })}
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
              onChange={(event) => update({ apiKey: event.target.value })}
              placeholder={adding ? '' : '••••••'}
              data-testid="provider-key"
            />
            <span className="src">{t('settings.apiKeyHint')}</span>
          </div>
          {saveError !== null && (
            <div className="note st block" data-testid="provider-save-error">
              {saveError}
            </div>
          )}
        </div>
        <div className="btns">
          <button
            type="button"
            className="btn pri"
            onClick={() => void save()}
            disabled={draft.api === '' || saving}
            data-testid="provider-save"
          >
            {saving ? t('settings.saving') : t('common.save')}
          </button>
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
