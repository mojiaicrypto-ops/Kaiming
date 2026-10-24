import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { ROLES, useRoleConfigs, type ConfigView, type RoleId } from './config-model';
import type { RpcClient } from '../api/rpc';
import { errorText } from '../lib/errors';

export interface ModelsPageProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly onSaved: (message: string) => void;
  readonly onError: (message: string) => void;
}

/**
 * Model assignment, in the layers the server really has: each role globally, a project's default,
 * and one role inside a project. Every row edits the layer it owns — the select shows what THAT layer
 * stores, and the badge says which layer the run actually ends up using (role in project → role →
 * project → default), so an inherited model never looks like a saved choice.
 */
export function ModelsPage({ rpc, projectId, onSaved, onError }: ModelsPageProps) {
  const { t } = useI18n();
  const [scope, setScope] = useState<'global' | 'project'>(projectId === '' ? 'global' : 'project');
  const [saving, setSaving] = useState<string | null>(null);
  const globalRoles = useRoleConfigs(rpc, undefined);
  const projectRoles = useRoleConfigs(rpc, projectId === '' ? undefined : projectId);
  const roles = scope === 'global' ? globalRoles : projectRoles;
  const models = (globalRoles.configs[0]?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({ providerId: provider.providerId, modelId: model.id })),
  );
  const failed = roles.failed;

  const commit = async (key: string, run: () => Promise<unknown>, reload: () => Promise<void>): Promise<void> => {
    setSaving(key);
    try {
      await run();
      await reload();
      onSaved(t('settings.saved'));
    } catch (error) {
      onError(t('settings.saveFailed', { reason: errorText(error, t) }));
    } finally {
      setSaving(null);
    }
  };

  /** Assign or clear one layer. An empty choice means "inherit", which removes that row's override. */
  const assign = async (
    key: string,
    layer: { roleId?: string; projectId?: string },
    modelId: string,
    revision: number | null,
    reload: () => Promise<void>,
  ): Promise<void> => {
    const model = models.find((entry) => entry.modelId === modelId);
    if (modelId === '') {
      await commit(key, () => rpc.call('config.clear', layer, { requestId: `clear-${Date.now()}` }), reload);
      return;
    }
    if (model === undefined) return;
    await commit(
      key,
      () =>
        rpc.call(
          'config.save',
          {
            ...layer,
            // The revision of the row being changed: null creates, a number updates. Sending null for
            // an existing row made a second change fail as a conflict.
            expectedRevision: revision,
            value: { kind: 'model', providerId: model.providerId, modelId: model.modelId },
          },
          { requestId: `assign-${Date.now()}` },
        ),
      reload,
    );
  };

  const sourceLabel = (source: string): string =>
    source === 'project-role'
      ? t('settings.src.projectRole')
      : source === 'project'
        ? t('settings.src.override')
        : source === 'role'
          ? t('settings.src.role')
          : source === 'server'
            ? t('settings.src.global')
            : t('settings.src.inherited');

  const options = (stored: string, inherited: string): ReactNode => (
    <>
      <option value="">
        {stored === '' && inherited !== ''
          ? t('settings.defaultModelWith', { model: inherited })
          : t('settings.defaultModel')}
      </option>
      {models.map((model) => (
        <option key={`${model.providerId}:${model.modelId}`} value={model.modelId}>
          {model.modelId}
        </option>
      ))}
      {/* A saved model the provider no longer offers must stay visible, or the row would look like it
          inherited the default while a run would still try the missing model. */}
      {stored !== '' && !models.some((model) => model.modelId === stored) && (
        <option value={stored}>{stored}</option>
      )}
    </>
  );

  const roleConfig = (role: RoleId): ConfigView | undefined =>
    roles.configs.find((config) => config.roleId === role);

  return (
    <section className="set-pane scroll">
      <div className="set-in">
        <h1>{t('settings.models')}</h1>
        <p className="f3">{t('settings.modelsDesc')}</p>
        <div className="set-body" data-testid="models">
          {failed && <State kind="block">{t('settings.readFailed')}</State>}
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
                data-testid="scope-project"
              >
                {t('settings.scope.project')}
              </button>
            </span>
          </div>
          {scope === 'project' && (
            <div className="rl">
              <span>{t('settings.scope.projectDefault')}</span>
              <select
                className="sel"
                aria-label={t('settings.scope.projectDefault')}
                value={roleConfig('chief')?.overrides.project?.modelId ?? ''}
                onChange={(event) =>
                  void assign(
                    'project',
                    { projectId },
                    event.target.value,
                    roleConfig('chief')?.overrides.project?.revision ?? null,
                    projectRoles.reload,
                  )
                }
                disabled={saving !== null || models.length === 0}
                data-testid="model-project"
              >
                {/* No single inherited value exists for "the whole project": the roles differ. */}
                {options(roleConfig('chief')?.overrides.project?.modelId ?? '', '')}
              </select>
              <span
                className={roleConfig('chief')?.overrides.project ? 'src ov' : 'src'}
              >
                {roleConfig('chief')?.overrides.project ? sourceLabel('project') : t('settings.notSet')}
              </span>
            </div>
          )}
          {ROLES.map((entry) => {
            const config = roleConfig(entry);
            const own = scope === 'global' ? config?.overrides.role : config?.overrides.projectRole;
            const source = config?.effective.source ?? '';
            const modelLabel = t(`settings.role.${entry}` as 'settings.role.chief');
            return (
              <div className="rl" key={`${scope}-${entry}`}>
                <span>{modelLabel}</span>
                <select
                  className="sel"
                  aria-label={modelLabel}
                  value={own?.modelId ?? ''}
                  onChange={(event) =>
                    void assign(
                      `${scope}-${entry}`,
                      scope === 'global' ? { roleId: entry } : { projectId, roleId: entry },
                      event.target.value,
                      own?.revision ?? null,
                      roles.reload,
                    )
                  }
                  disabled={saving !== null || models.length === 0}
                  data-testid={scope === 'global' ? `model-${entry}` : `model-project-${entry}`}
                >
                  {options(own?.modelId ?? '', config?.effective.modelId ?? '')}
                </select>
                <span className={own !== null && own !== undefined ? 'src ov' : 'src'} title={sourceLabel(source)}>
                  {config === undefined ? '' : sourceLabel(source)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
