/**
 * The Agents view: the effective role profiles the server resolves. There is no agent-listing RPC,
 * so the list is built from `config.get` per role id (the seven role ids the runtime ships). The card
 * shows the effective provider/model, where that selection came from, and that credentials are
 * referenced only - no secret value can appear here.
 */
import { el, qs, replace } from '../core/dom.js';

const ROLE_IDS = ['chief', 'designer', 'developer', 'reviewer', 'tester', 'settler', 'investigator'];

export function createAgentsView(context) {
  const { rpc, store, i18n } = context;
  const container = qs('#agentsContent');
  let configs = null;
  let loadedFor = null;
  let loading = false;
  let signature = null;

  const t = (key) => i18n.t(key);

  async function load() {
    if (store.projectId === null || loading) {
      return;
    }
    loading = true;
    try {
      configs = await Promise.all(
        ROLE_IDS.map(async (roleId) => {
          try {
            return await rpc.call('config.get', { roleId, projectId: store.projectId });
          } catch (error) {
            return { roleId, error: error?.message ?? String(error) };
          }
        }),
      );
      loadedFor = store.projectId;
    } finally {
      loading = false;
    }
  }

  async function sync() {
    if (store.projectId !== null && loadedFor !== store.projectId && !loading) {
      await load();
    }
    paint();
  }

  function sourceLabel(source) {
    return source === 'server' || source === undefined ? t('agents.global') : t('agents.override');
  }

  function card(config) {
    const roleId = config.roleId;
    const effective = config.effective ?? {};
    const failed = config.error !== undefined;
    return el('article', { class: 'profile-card', dataset: { roleCard: roleId } }, [
      el('div', { class: 'profile-head' }, [
        el('div', { class: 'profile-role' }, [
          el('code', { text: roleId.toUpperCase() }),
          el('strong', { text: t(`agents.role.${roleId}`) }),
        ]),
        el('span', {
          class: `source-badge${effective.source === 'server' ? '' : ' override'}`,
          text: sourceLabel(effective.source),
        }),
      ]),
      el('div', { class: 'profile-model' }, [
        el('strong', { text: failed ? config.error : `${effective.providerId ?? '—'} · ${effective.modelId ?? '—'}` }),
        el('small', { text: t('agents.credentials') }),
      ]),
      el('div', { class: 'profile-meta' }, [
        el('span', { text: `${t('settings.source')} · ${effective.source ?? 'unknown'}` }),
        el('span', { text: `${t('settings.agentDir')} · ${effective.agentDir ?? '—'}` }),
      ]),
    ]);
  }

  function paint() {
    if (container === null) {
      return;
    }
    const next = [
      i18n.language,
      store.projectId ?? 'none',
      configs === null
        ? 'none'
        : configs
            .map(
              (config) =>
                `${config.roleId}:${config.effective?.source ?? '?'}:${config.effective?.modelId ?? '?'}:${config.error ?? ''}`,
            )
            .join(','),
    ].join('|');
    if (next === signature) {
      return;
    }
    signature = next;
    if (store.projectId === null) {
      replace(container, el('p', { class: 'muted', text: t('agents.noProject') }));
      return;
    }
    if (configs === null) {
      replace(container, el('p', { class: 'muted', text: t('common.loading') }));
      return;
    }
    replace(
      container,
      el('div', { class: 'config-intro' }, [
        el('div', {}, [el('strong', { text: t('agents.introTitle') }), el('p', { text: t('agents.introDetail') })]),
        el('span', { class: 'config-chip', text: t('agents.reference') }),
      ]),
      el('div', { class: 'profile-grid' }, configs.map((config) => card(config))),
    );
  }

  return {
    id: 'agents',
    mount() {
      signature = null;
      loadedFor = null;
      void sync();
    },
    update() {
      void sync();
    },
  };
}
