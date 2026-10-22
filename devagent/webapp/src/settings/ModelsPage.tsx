import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { ROLES, useConfig, useRoleConfigs, type ConfigView, type RoleId } from './config-model';
import type { RpcClient } from '../api/rpc';

export interface ModelsPageProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly onSaved: (message: string) => void;
  readonly onError: (message: string) => void;
}

/**
 * Model assignment, in the two scopes the server really has: one model per role (global), or one
 * model for a project (project). The scope switch changes what is *edited*, not only what is read —
 * the server takes exactly one of `roleId`/`projectId` on a save, so a project-scope save that sent
 * a role id would quietly rewrite the global override.
 */
export function ModelsPage({ rpc, projectId, onSaved, onError }: ModelsPageProps) {
  const { t } = useI18n();
  const [scope, setScope] = useState<'global' | 'project'>(projectId === '' ? 'global' : 'project');
  const [saving, setSaving] = useState<string | null>(null);
  const roles = useRoleConfigs(rpc, undefined);
  const project = useConfig(rpc, projectId === '' ? undefined : projectId, 'chief');
  const models = (roles.configs[0]?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({ providerId: provider.providerId, modelId: model.id })),
  );
  const failed = scope === 'global' ? roles.failed : project.failed;

  const save = async (key: string, value: Record<string, unknown>, reload: () => Promise<void>): Promise<void> => {
    setSaving(key);
    try {
      await rpc.call('config.save', { ...value, expectedRevision: null });
      await reload();
      onSaved(t('settings.saved'));
    } catch (error) {
      onError(t('settings.saveFailed', { reason: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(null);
    }
  };

  const assignRole = async (role: RoleId, modelId: string): Promise<void> => {
    const provider = models.find((entry) => entry.modelId === modelId);
    if (provider === undefined) return;
    await save(
      role,
      { roleId: role, value: { kind: 'model', providerId: provider.providerId, modelId: provider.modelId } },
      roles.reload,
    );
  };

  const assignProject = async (modelId: string): Promise<void> => {
    const provider = models.find((entry) => entry.modelId === modelId);
    if (provider === undefined || projectId === '') return;
    await save(
      'project',
      { projectId, value: { kind: 'model', providerId: provider.providerId, modelId: provider.modelId } },
      project.reload,
    );
  };

  const sourceLabel = (source: string): string =>
    source === 'project'
      ? t('settings.src.override')
      : source === 'role'
        ? t('settings.src.role')
        : source === 'server'
          ? t('settings.src.global')
          : t('settings.src.inherited');

  const options = (selected: string): ReactNode => (
    <>
      <option value="">{t('settings.defaultModel')}</option>
      {models.map((model) => (
        <option key={`${model.providerId}:${model.modelId}`} value={model.modelId}>
          {model.modelId}
        </option>
      ))}
      {/* A saved model the provider no longer offers must stay visible, or the row would look
          like it inherited the default while a run would still try the missing model. */}
      {selected !== '' && !models.some((model) => model.modelId === selected) && (
        <option value={selected}>{selected}</option>
      )}
    </>
  );

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
          {scope === 'global' ? (
            ROLES.map((entry, index) => {
              const config: ConfigView | undefined = roles.configs[index];
              const source = config?.effective.source ?? '';
              return (
                <div className="rl" key={entry}>
                  <span>{t(`settings.role.${entry}` as 'settings.role.chief')}</span>
                  <select
                    className="sel"
                    aria-label={t(`settings.role.${entry}` as 'settings.role.chief')}
                    value={config?.effective.modelId ?? ''}
                    onChange={(event) => void assignRole(entry, event.target.value)}
                    disabled={saving !== null || models.length === 0}
                    data-testid={`model-${entry}`}
                  >
                    {options(config?.effective.modelId ?? '')}
                  </select>
                  <span className={source === 'role' ? 'src ov' : 'src'}>{sourceLabel(source)}</span>
                </div>
              );
            })
          ) : (
            <div className="rl">
              <span>{t('settings.scope.project')}</span>
              <select
                className="sel"
                aria-label={t('settings.scope.project')}
                value={project.config?.effective.source === 'project' ? project.config.effective.modelId : ''}
                onChange={(event) => void assignProject(event.target.value)}
                disabled={saving !== null || models.length === 0}
                data-testid="model-project"
              >
                {options(
                  project.config?.effective.source === 'project' ? project.config.effective.modelId : '',
                )}
              </select>
              <span className={project.config?.effective.source === 'project' ? 'src ov' : 'src'}>
                {project.config === null ? '' : sourceLabel(project.config.effective.source)}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
