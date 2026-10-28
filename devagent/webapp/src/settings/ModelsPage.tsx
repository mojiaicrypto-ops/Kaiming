import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { ROLES, useRoleConfigs, type Assignment, type ConfigView, type ProviderView, type RoleId } from './config-model';
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
 *
 * The thinking level travels with the model on the same row. Its choices come from Pi per model, so a
 * row can never offer a level the run would clamp away; an inherited row shows the inherited level
 * instead of pretending the user chose one.
 */
export function ModelsPage({ rpc, projectId, onSaved, onError }: ModelsPageProps) {
  const { t } = useI18n();
  const [scope, setScope] = useState<'global' | 'project'>(projectId === '' ? 'global' : 'project');
  const [saving, setSaving] = useState<string | null>(null);
  const globalRoles = useRoleConfigs(rpc, undefined);
  const projectRoles = useRoleConfigs(rpc, projectId === '' ? undefined : projectId);
  const roles = scope === 'global' ? globalRoles : projectRoles;
  const providers: readonly ProviderView[] = globalRoles.configs[0]?.providers ?? [];
  const models = providers.flatMap((provider) =>
    provider.models.map((model) => ({ providerId: provider.providerId, modelId: model.id })),
  );
  const failed = roles.failed;
  const [compaction, setCompaction] = useState<{ auto: boolean; thresholdPercent: number; revision: number } | null>(null);
  const [compactionFailed, setCompactionFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void rpc
      .call<{ config: { auto: boolean; thresholdPercent: number; revision: number } }>('compaction.get', {})
      .then((read) => {
        if (!cancelled) setCompaction(read.config);
      })
      .catch(() => {
        if (!cancelled) setCompactionFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const saveCompaction = async (next: { auto: boolean; thresholdPercent: number }): Promise<void> => {
    if (compaction === null) return;
    setSaving('compaction');
    try {
      const read = await rpc.call<{ config: { auto: boolean; thresholdPercent: number; revision: number } }>(
        'compaction.save',
        { ...next, expectedRevision: compaction.revision },
        { requestId: `compaction-${Date.now()}` },
      );
      setCompaction(read.config);
      setCompactionFailed(false);
      onSaved(t('settings.saved'));
    } catch (error) {
      onError(t('settings.saveFailed', { reason: errorText(error, t) }));
    } finally {
      setSaving(null);
    }
  };

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

  /** The levels Pi accepts for a model, as the server reported them (never a local list). */
  const levelsOf = (providerId: string, modelId: string): readonly string[] =>
    providers.find((provider) => provider.providerId === providerId)?.models.find((model) => model.id === modelId)
      ?.thinkingLevels ?? ['off'];

  /** Assign or clear one layer. An empty choice means "inherit", which removes that row's override. */
  const assign = async (
    key: string,
    layer: { roleId?: string; projectId?: string },
    modelId: string,
    own: Assignment | null | undefined,
    reload: () => Promise<void>,
  ): Promise<void> => {
    const model = models.find((entry) => entry.modelId === modelId);
    if (modelId === '') {
      await commit(key, () => rpc.call('config.clear', layer, { requestId: `clear-${Date.now()}` }), reload);
      return;
    }
    if (model === undefined) return;
    // Keep the level only when the new model still accepts it: a level belongs to a model, and
    // carrying one over silently would either be clamped or rejected without the user seeing why.
    const kept = own?.thinkingLevel ?? '';
    const thinkingLevel = kept !== '' && levelsOf(model.providerId, model.modelId).includes(kept) ? kept : '';
    await commit(
      key,
      () =>
        rpc.call(
          'config.save',
          {
            ...layer,
            // The revision of the row being changed: null creates, a number updates. Sending null for
            // an existing row made a second change fail as a conflict.
            expectedRevision: own?.revision ?? null,
            value: { kind: 'model', providerId: model.providerId, modelId: model.modelId, thinkingLevel },
          },
          { requestId: `assign-${Date.now()}` },
        ),
      reload,
    );
  };

  /** The level is a field of the row that already exists: only its value changes. */
  const assignLevel = async (
    key: string,
    layer: { roleId?: string; projectId?: string },
    own: Assignment,
    thinkingLevel: string,
    reload: () => Promise<void>,
  ): Promise<void> => {
    await commit(
      key,
      () =>
        rpc.call(
          'config.save',
          {
            ...layer,
            expectedRevision: own.revision,
            value: {
              kind: 'model',
              providerId: own.providerId,
              modelId: own.modelId,
              thinkingLevel,
            },
          },
          { requestId: `level-${Date.now()}` },
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

  const levelLabel = (level: string): string =>
    level === '' ? t('settings.level.unset') : t(`settings.level.${level}` as 'settings.level.off');

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

  /**
   * The level control for one row, in three honest shapes:
   * - the row owns its model and Pi offers choices → a select of exactly those choices;
   * - the row owns a model that declares no reasoning → the model simply has no levels to pick;
   * - the row inherits its model → the level that will really run, not a choice the row does not hold.
   */
  const levelControl = (
    key: string,
    layer: { roleId?: string; projectId?: string },
    own: Assignment | null | undefined,
    inherited: { modelId: string; thinkingLevel: string },
    reload: () => Promise<void>,
    testId: string,
  ): ReactNode => {
    if (own === null || own === undefined) {
      // Only a model this installation can actually run has a level worth showing: the server's
      // "unset" default is the absence of a model, and a stale id no provider offers is the same.
      const known = models.some((model) => model.modelId === inherited.modelId);
      return (
        <span className="src lvl-inherited" title={t('settings.level.inherited')} data-testid={`${testId}-inherited`}>
          {known ? levelLabel(inherited.thinkingLevel) : ''}
        </span>
      );
    }
    const levels = levelsOf(own.providerId, own.modelId);
    if (levels.length <= 1) {
      return (
        <span className="src lvl-none" title={t('settings.level.unsupportedHint')} data-testid={`${testId}-unsupported`}>
          {t('settings.level.unsupported')}
        </span>
      );
    }
    const stored = own.thinkingLevel ?? '';
    return (
      <select
        className="sel lvl"
        aria-label={t('settings.level')}
        title={t('settings.levelHint')}
        value={stored}
        onChange={(event) => void assignLevel(key, layer, own, event.target.value, reload)}
        disabled={saving !== null}
        data-testid={testId}
      >
        <option value="">{t('settings.level.unset')}</option>
        {/* A saved level this model no longer offers stays visible: hiding it would make the run's
            clamped level look like a choice nobody made. */}
        {stored !== '' && !levels.includes(stored) && <option value={stored}>{levelLabel(stored)}</option>}
        {levels
          .filter((level) => level !== 'off')
          .map((level) => (
            <option key={level} value={level}>
              {levelLabel(level)}
            </option>
          ))}
      </select>
    );
  };

  const roleConfig = (role: RoleId): ConfigView | undefined =>
    roles.configs.find((config) => config.roleId === role);

  const projectRow = (): ReactNode => {
    const config = roleConfig('chief');
    const own = config?.overrides.project;
    const inherited = { modelId: '', thinkingLevel: '' };
    return (
      <div className="rl">
        <span>{t('settings.scope.projectDefault')}</span>
        <select
          className="sel"
          aria-label={t('settings.scope.projectDefault')}
          value={own?.modelId ?? ''}
          onChange={(event) => void assign('project', { projectId }, event.target.value, own, projectRoles.reload)}
          disabled={saving !== null || models.length === 0}
          data-testid="model-project"
        >
          {/* No single inherited value exists for "the whole project": the roles differ. */}
          {options(own?.modelId ?? '', '')}
        </select>
        {levelControl('project', { projectId }, own, inherited, projectRoles.reload, 'level-project')}
        <span className={own ? 'src ov' : 'src'}>
          {own ? sourceLabel('project') : t('settings.notSet')}
        </span>
      </div>
    );
  };

  return (
    <section className="set-pane scroll">
      <div className="set-in">
        <h1>{t('settings.models')}</h1>
        <p className="f3">{t('settings.modelsDesc')}</p>
        <div className="set-body" data-testid="models">
          <div className="cmp" data-testid="compaction-settings">
            <div className="cmp-h">
              <span>{t('settings.compaction')}</span>
              <span className="src">{t('settings.compactionGlobal')}</span>
            </div>
            {compactionFailed ? (
              <State kind="block">{t('settings.readFailed')}</State>
            ) : compaction === null ? (
              <p className="f3">{t('common.loading')}</p>
            ) : (
              <>
                <div className="cmp-row">
                  <label className="cmp-check">
                    <input
                      type="checkbox"
                      checked={compaction.auto}
                      disabled={saving !== null}
                      onChange={(event) => void saveCompaction({ auto: event.target.checked, thresholdPercent: compaction.thresholdPercent })}
                      data-testid="compaction-auto"
                    />
                    {t('settings.compactionAuto')}
                  </label>
                  <label className="cmp-at">
                    {t('settings.compactionAt')}
                    <select
                      className="sel"
                      value={compaction.thresholdPercent}
                      disabled={saving !== null}
                      onChange={(event) =>
                        void saveCompaction({ auto: compaction.auto, thresholdPercent: Number(event.target.value) })
                      }
                      data-testid="compaction-threshold"
                    >
                      {[50, 55, 60, 65, 70, 75, 80, 85, 90, 95].map((value) => (
                        <option key={value} value={value}>
                          {value}%
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="f3 cmp-desc">{t('settings.compactionHint')}</p>
              </>
            )}
          </div>
          {failed && <State kind="block">{t('settings.readFailed')}</State>}
          <div className="row" style={{ marginBottom: 'var(--s4)' }}>
            <span className="seg">
              <button
                type="button"
                aria-pressed={scope === 'global'}
                onClick={() => setScope('global')}
                data-testid="scope-global"
              >
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
          {scope === 'project' && projectRow()}
          {ROLES.map((entry) => {
            const config = roleConfig(entry);
            const own = scope === 'global' ? config?.overrides.role : config?.overrides.projectRole;
            const source = config?.effective.source ?? '';
            const modelLabel = t(`settings.role.${entry}` as 'settings.role.chief');
            const layer = scope === 'global' ? { roleId: entry } : { projectId, roleId: entry };
            return (
              <div className="rl" key={`${scope}-${entry}`}>
                <span>{modelLabel}</span>
                <select
                  className="sel"
                  aria-label={modelLabel}
                  value={own?.modelId ?? ''}
                  onChange={(event) => void assign(`${scope}-${entry}`, layer, event.target.value, own, roles.reload)}
                  disabled={saving !== null || models.length === 0}
                  data-testid={scope === 'global' ? `model-${entry}` : `model-project-${entry}`}
                >
                  {options(own?.modelId ?? '', config?.effective.modelId ?? '')}
                </select>
                {levelControl(
                  `${scope}-${entry}`,
                  layer,
                  own,
                  {
                    modelId: config?.effective.modelId ?? '',
                    thinkingLevel: config?.effective.thinkingLevel ?? 'off',
                  },
                  roles.reload,
                  scope === 'global' ? `level-${entry}` : `level-project-${entry}`,
                )}
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
