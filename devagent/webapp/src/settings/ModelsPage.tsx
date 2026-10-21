import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { ROLES, useRoleConfigs, type ConfigView, type RoleId } from './config-model';
import type { RpcClient } from '../api/rpc';

export interface ModelsPageProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly onSaved: (message: string) => void;
  readonly onError: (message: string) => void;
}

/**
 * Role → model assignment, with the global / this-project scope switch. The source column is not
 * decoration: it is how a user tells "this role runs the global model" from "this project
 * overrides it", which is the only way to understand why a change did not take effect.
 */
export function ModelsPage({ rpc, projectId, onSaved, onError }: ModelsPageProps) {
  const { t } = useI18n();
  const [scope, setScope] = useState<'global' | 'project'>(projectId === '' ? 'global' : 'project');
  const [saving, setSaving] = useState<string | null>(null);
  const { configs, failed, reload } = useRoleConfigs(rpc, scope === 'project' ? projectId : undefined);
  const models = (configs[0]?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({ providerId: provider.providerId, modelId: model.id })),
  );

  const assign = async (role: RoleId, modelId: string): Promise<void> => {
    if (modelId === '') return;
    const provider = models.find((entry) => entry.modelId === modelId);
    if (provider === undefined) return;
    setSaving(role);
    try {
      // Saving one role re-reads only that role's effective config: the other rows keep the
      // values the server resolved, so a failed save cannot leave a row showing a lie.
      await rpc.call('config.save', {
        roleId: role,
        expectedRevision: null,
        value: { kind: 'model', providerId: provider.providerId, modelId: provider.modelId },
      });
      await reload();
      onSaved(t('settings.saved'));
    } catch (error) {
      onError(t('settings.saveFailed', { reason: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="set-pane scroll">
      <div className="set-in">
        <h1>{t('settings.models')}</h1>
        <p className="f3">{t('settings.modelsDesc')}</p>
        <div className="set-body" data-testid="models">
          {failed && <div className="st block">{t('settings.readFailed')}</div>}
          <div className="row" style={{ marginBottom: 'var(--s4)' }}>
            <span className="seg">
              <button type="button" aria-pressed={scope === 'global'} onClick={() => setScope('global')}>
                {t('settings.scope.global')}
              </button>
              <button
                type="button"
                aria-pressed={scope === 'project'}
                onClick={() => setScope('project')}
                disabled={projectId === ''}
              >
                {t('settings.scope.project')}
              </button>
            </span>
          </div>
          {ROLES.map((entry, index) => {
            const config: ConfigView | undefined = configs[index];
            const source = config?.effective.source ?? '';
            return (
              <div className="rl" key={entry}>
                <span>{t(`settings.role.${entry}` as 'settings.role.chief')}</span>
                <select
                  className="sel"
                  aria-label={t(`settings.role.${entry}` as 'settings.role.chief')}
                  value={config?.effective.modelId ?? ''}
                  onChange={(event) => void assign(entry, event.target.value)}
                  disabled={saving !== null || models.length === 0}
                  data-testid={`model-${entry}`}
                >
                  <option value="">{t('settings.defaultModel')}</option>
                  {models.map((model) => (
                    <option key={`${model.providerId}:${model.modelId}`} value={model.modelId}>
                      {model.modelId}
                    </option>
                  ))}
                </select>
                <span className={source === 'project' || source === 'role' ? 'src ov' : 'src'}>
                  {source === 'project'
                    ? t('settings.src.override')
                    : source === 'role'
                      ? t('settings.src.role')
                      : t('settings.src.inherited')}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
