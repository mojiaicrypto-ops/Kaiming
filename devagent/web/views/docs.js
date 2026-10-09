/**
 * Docs view: the project's knowledge entries (K-02). The presence of the fixed entries
 * (`AGENTS.md`, `.dev/INDEX.md`, `.dev/PROJECT.md`) comes from `project.get`, and the chosen entry's
 * text is read through `project.files.read` and rendered with the shared markdown renderer.
 *
 * A missing entry is a gap in the project, never an empty document: the pane says the entry is absent
 * and no read is attempted for it.
 */
import { el, qs, replace } from '../core/dom.js';
import { dataRow } from '../components/data-list.js';

export function createDocsView(context) {
  const { store, i18n, markdownIt } = context;
  const region = qs('#docsContent');
  const t = (key) => i18n.t(key);
  let project = null;
  let error = null;
  let mounted = false;
  let selectedPath = null;
  let reading = false;
  let entryDoc = null;

  const unsubscribe = store.subscribe('project', () => void loadProject());

  async function loadProject() {
    if (store.projectId === null) {
      project = null;
      error = null;
      paint();
      return;
    }
    try {
      const read = await store.rpc.call('project.get', { projectId: store.projectId });
      project = read.project;
      error = null;
    } catch (failure) {
      project = null;
      error = failure?.message ?? String(failure);
    }
    paint();
  }

  async function selectEntry(entry) {
    selectedPath = entry.path;
    entryDoc = null;
    if (entry.present !== true) {
      entryDoc = { path: entry.path, gap: true };
      paint();
      return;
    }
    reading = true;
    paint();
    try {
      const file = await store.rpc.call('project.files.read', {
        projectId: store.projectId,
        path: entry.path,
      });
      entryDoc = {
        path: entry.path,
        text: file.text ?? '',
        binary: file.binary === true,
        truncated: file.truncated === true,
      };
    } catch (failure) {
      entryDoc = { path: entry.path, error: failure?.message ?? String(failure) };
    } finally {
      reading = false;
      paint();
    }
  }

  function entryRow(entry) {
    const name = entry.path.split('/').pop() ?? entry.path;
    const id = name.replace(/\.[^.]+$/, '').toUpperCase();
    return dataRow({
      id,
      main: entry.path,
      meta: selectedPath === entry.path ? t('docs.selected') : '',
      status: entry.present ? t('docs.entryPresent') : t('docs.entryMissing'),
      onClick: () => void selectEntry(entry),
    });
  }

  function paint() {
    if (region === null) {
      return;
    }
    const nodes = [];
    if (error !== null) {
      nodes.push(el('p', { class: 'board-help', text: error }));
    }
    const entries = Array.isArray(project?.entries) ? project.entries : [];
    nodes.push(
      el('div', { class: 'config-section-title' }, [
        el('strong', { text: t('docs.entriesTitle') }),
        el('span', { text: String(entries.length) }),
      ]),
    );
    if (entries.length === 0) {
      nodes.push(el('p', { class: 'board-help', text: t('docs.noProject') }));
    } else {
      nodes.push(el('div', { class: 'data-list', role: 'list' }, entries.map(entryRow)));
      const missing = entries.filter((entry) => entry.present !== true);
      if (missing.length > 0) {
        nodes.push(
          el('div', { class: 'decision-card' }, [
            el('strong', { text: t('docs.gapTitle') }),
            el('ul', {}, missing.map((entry) => el('li', { text: t('docs.gap').replace('{path}', entry.path) }))),
          ]),
        );
      }
    }

    if (selectedPath === null) {
      nodes.push(el('p', { class: 'board-help', text: t('docs.select') }));
    } else if (reading) {
      nodes.push(el('p', { class: 'board-help', text: t('common.loading') }));
    } else if (entryDoc?.gap === true) {
      nodes.push(
        el('div', { class: 'decision-card' }, [
          el('strong', { text: t('docs.entryMissing') }),
          el('p', { text: t('docs.gap').replace('{path}', selectedPath) }),
        ]),
      );
    } else if (typeof entryDoc?.error === 'string') {
      nodes.push(el('p', { class: 'board-help', text: `${t('docs.readFailed')} ${entryDoc.error}` }));
    } else if (typeof entryDoc?.text === 'string') {
      const note = entryDoc.binary ? t('files.binary') : entryDoc.truncated ? t('files.truncated') : '';
      nodes.push(
        el('div', { class: 'config-section-title' }, [
          el('strong', { text: selectedPath }),
          el('span', { text: note }),
        ]),
      );
      nodes.push(el('div', { class: 'markdown-body', html: markdownIt.render(entryDoc.text) }));
    }
    replace(region, ...nodes);
  }

  return {
    id: 'docs',
    mount() {
      paint();
      if (!mounted) {
        mounted = true;
        void loadProject();
      }
    },
    update() {
      paint();
    },
    destroy() {
      unsubscribe();
    },
  };
}
