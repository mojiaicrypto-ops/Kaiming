/**
 * The Settings view: the server's effective configuration, the real Project identity, the
 * credential rule, and an explicit statement of what this build cannot do yet. Every button only
 * calls a method that exists today; a refresh re-reads `config.get` / `project.get`.
 */
import { el, qs, replace } from '../core/dom.js';

export function createSettingsView(context) {
  const { rpc, store, i18n, toast } = context;
  const container = qs('#settingsContent');
  let config = null;
  let project = null;
  let loadedFor = null;
  let loading = false;
  let signature = null;

  const t = (key) => i18n.t(key);

  function sessionRole() {
    const session = (store.sessions ?? []).find((entry) => entry.sessionId === store.sessionId);
    return session?.roleId ?? 'chief';
  }

  async function load() {
    if (store.projectId === null || loading) {
      return;
    }
    loading = true;
    try {
      const [readConfig, readProject] = await Promise.all([
        rpc.call('config.get', { roleId: sessionRole(), projectId: store.projectId }),
        rpc.call('project.get', { projectId: store.projectId }),
      ]);
      config = readConfig;
      project = readProject.project;
      loadedFor = store.projectId;
    } catch (error) {
      config = null;
      project = null;
      toast.error(error?.message ?? String(error));
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

  function facts(entries) {
    return el(
      'dl',
      { class: 'card-facts' },
      entries.map(([label, value]) =>
        el('div', {}, [el('dt', { text: label }), el('dd', { text: value === undefined || value === null || value === '' ? '—' : String(value) })]),
      ),
    );
  }

  function entryRows(project) {
    return (project.entries ?? []).map((entry) =>
      el('div', { class: 'data-row' }, [
        el('span', { class: 'data-id', text: 'ENTRY' }),
        el('span', { class: 'data-main' }, [
          el('strong', { text: entry.path }),
          el('small', { text: project.directoryExists ? '' : t('settings.missing') }),
        ]),
        el('span', { class: 'data-status', text: entry.present ? t('settings.present') : t('settings.absent') }),
      ]),
    );
  }

  function paint() {
    if (container === null) {
      return;
    }
    const next = [i18n.language, store.projectId ?? 'none', sessionRole(), config?.effective?.modelId ?? '?', project?.revision ?? '?'].join('|');
    if (next === signature) {
      return;
    }
    signature = next;
    if (store.projectId === null) {
      replace(container, el('p', { class: 'muted', text: t('settings.noProject') }));
      return;
    }
    if (config === null || project === null) {
      replace(container, el('p', { class: 'muted', text: t('common.loading') }));
      return;
    }
    const effective = config.effective ?? {};
    const refresh = el('button', {
      class: 'config-button',
      type: 'button',
      text: t('settings.refresh'),
      onclick: () => {
        loadedFor = null;
        signature = null;
        void sync();
      },
    });
    replace(
      container,
      el('section', { class: 'config-section' }, [
        el('div', { class: 'config-intro' }, [
          el('div', {}, [el('strong', { text: t('settings.layersTitle') }), el('p', { text: t('settings.layersDetail') })]),
          el('span', { class: 'config-chip', text: effective.source ?? 'unknown' }),
        ]),
      ]),
      el('section', { class: 'config-section' }, [
        el('div', { class: 'config-section-title' }, [
          el('strong', { text: t('settings.effectiveTitle') }),
          el('span', { text: `${t('settings.role')} · ${config.roleId}` }),
        ]),
        facts([
          [t('settings.provider'), effective.providerId],
          [t('settings.model'), effective.modelId],
          [t('settings.source'), effective.source],
          [t('settings.agentDir'), effective.agentDir],
          [t('settings.promptDir'), effective.promptDir],
        ]),
        el('p', { class: 'dialog-note', text: t('settings.credentialRule') }),
      ]),
      el('section', { class: 'config-section' }, [
        el('div', { class: 'config-section-title' }, [
          el('strong', { text: t('settings.projectTitle') }),
          el('span', { text: `${t('settings.revision')} · ${project.revision}` }),
        ]),
        facts([
          [t('settings.path'), project.realPath],
          [t('settings.revision'), project.revision],
          [t('settings.directory'), project.directoryExists ? t('settings.present') : t('settings.missing')],
        ]),
        project.problem === undefined ? null : el('p', { class: 'dialog-note', text: project.problem }),
        el('div', { class: 'data-list', role: 'list' }, entryRows(project)),
      ]),
      el('section', { class: 'config-section' }, [
        el('div', { class: 'config-intro' }, [
          el('div', {}, [
            el('strong', { text: t('settings.notImplementedTitle') }),
            el('p', { text: t('settings.notImplemented') }),
          ]),
        ]),
      ]),
      el('div', { class: 'profile-actions' }, [refresh]),
    );
  }

  return {
    id: 'settings',
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
