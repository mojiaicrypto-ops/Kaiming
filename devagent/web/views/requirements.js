/**
 * Requirements view (the mock's requirement board, real records): the project's
 * `.dev/requirements/*.md` records (F1-F4) as filterable rows, one dialog per record that shows the
 * record text plus any format problems, and the unreadable files as their own section.
 *
 * Nothing is synthesized: an empty directory names the expected location, an invalid record shows the
 * reasons the parser reported, and the text is the file's own content.
 */
import { el, qs, relativeTime, replace } from '../core/dom.js';
import { dataRow } from '../components/data-list.js';

const KINDS = ['proposal', 'implementation'];
const STATUSES = ['pending', 'planning', 'in_progress', 'completed', 'cancelled', 'archived'];

export function createRequirementsView(context) {
  const { store, i18n, dialog, toast } = context;
  const region = qs('#requirementsContent');
  const t = (key) => i18n.t(key);
  let kind = '';
  let status = '';
  let mounted = false;
  let loading = false;
  let error = null;

  const unsubscribe = store.subscribe('requirement', () => paint());

  async function load() {
    if (store.projectId === null) {
      paint();
      return;
    }
    loading = true;
    error = null;
    paint();
    try {
      await store.refreshRequirements();
    } catch (failure) {
      error = failure?.message ?? String(failure);
    } finally {
      loading = false;
      paint();
    }
  }

  function paint() {
    if (region === null) {
      return;
    }
    const all = Array.isArray(store.requirements) ? store.requirements : [];
    const invalid = Array.isArray(store.invalidRequirementFiles) ? store.invalidRequirementFiles : [];
    const items = all.filter(
      (entry) => (kind === '' || entry.kind === kind) && (status === '' || entry.status === status),
    );
    const nodes = [filters()];
    if (loading) {
      nodes.push(el('p', { class: 'board-help', text: t('common.loading') }));
    }
    if (error !== null) {
      nodes.push(el('p', { class: 'board-help', text: error }));
    }
    if (items.length > 0) {
      nodes.push(el('div', { class: 'data-list', role: 'list' }, items.map(requirementRow)));
    } else if (!loading && invalid.length === 0 && error === null) {
      // No records at all: say where one belongs, do not imply a loaded but empty record.
      nodes.push(el('p', { class: 'board-help', text: t('requirements.empty') }));
    }
    if (invalid.length > 0) {
      nodes.push(
        el('div', { class: 'config-section-title' }, [
          el('strong', { text: t('requirements.invalidTitle') }),
          el('span', { text: String(invalid.length) }),
        ]),
      );
      nodes.push(el('div', { class: 'data-list', role: 'list' }, invalid.map(invalidRow)));
    }
    replace(region, ...nodes);
  }

  function filters() {
    const kindSelect = el(
      'select',
      {
        'aria-label': t('requirements.filterKind'),
        onchange: (event) => {
          kind = event.currentTarget.value;
          paint();
        },
      },
      [
        el('option', { value: '', text: t('requirements.all'), selected: kind === '' ? true : undefined }),
        ...KINDS.map((value) =>
          el('option', { value, text: value, selected: kind === value ? true : undefined }),
        ),
      ],
    );
    const statusSelect = el(
      'select',
      {
        'aria-label': t('requirements.filterStatus'),
        onchange: (event) => {
          status = event.currentTarget.value;
          paint();
        },
      },
      [
        el('option', { value: '', text: t('requirements.all'), selected: status === '' ? true : undefined }),
        ...STATUSES.map((value) =>
          el('option', { value, text: value, selected: status === value ? true : undefined }),
        ),
      ],
    );
    return el('div', { class: 'dialog-body' }, [
      el('div', { class: 'field-row' }, [
        el('div', {}, [el('label', { text: t('requirements.filterKind') }), kindSelect]),
        el('div', {}, [el('label', { text: t('requirements.filterStatus') }), statusSelect]),
      ]),
    ]);
  }

  function requirementRow(entry) {
    const updated = relativeTime(entry.updatedAt) || String(entry.updatedAt ?? '');
    return dataRow({
      id: entry.id,
      main: entry.title,
      meta: `${entry.kind} · ${updated} · ${String(entry.version ?? '').slice(0, 12)}`,
      status: entry.status,
      onClick: () => void openRecord(entry),
    });
  }

  function invalidRow(file) {
    const issues = Array.isArray(file.issues) ? file.issues : [];
    return dataRow({
      id: file.file,
      main: issues[0] ?? t('requirements.invalidTitle'),
      meta: issues.slice(1).join(' · '),
      status: t('requirements.invalidStatus'),
    });
  }

  async function openRecord(entry) {
    try {
      const read = await store.rpc.call('requirement.get', {
        projectId: store.projectId,
        requirementId: entry.id,
      });
      await dialog.open({
        title: `${read.requirementId} · ${entry.title}`,
        body: recordBody(read),
        submitLabel: t('common.close'),
      });
    } catch (failure) {
      toast.error(failure?.message ?? String(failure));
    }
  }

  function recordBody(read) {
    const nodes = [];
    const issues = Array.isArray(read.issues) ? read.issues : [];
    if (issues.length > 0) {
      nodes.push(
        el('div', { class: 'decision-card' }, [
          el('strong', { text: t('requirements.issues') }),
          el('ul', {}, issues.map((issue) => el('li', { text: issue }))),
        ]),
      );
    }
    const metadata = read.metadata ?? null;
    nodes.push(
      el('dl', { class: 'card-facts' }, [
        fact(t('requirements.kind'), metadata?.kind ?? t('requirement.none')),
        fact(t('requirements.status'), metadata?.status ?? t('requirement.none')),
        fact(t('requirements.updated'), metadata?.updatedAt ?? t('requirement.none')),
        fact(t('requirements.version'), String(read.version ?? '').slice(0, 12)),
        fact(t('requirements.path'), read.path ?? ''),
      ]),
    );
    nodes.push(el('div', { class: 'config-section-title' }, [el('strong', { text: t('requirements.text') })]));
    nodes.push(
      el('div', { class: 'code-scroll', style: 'max-height:260px' }, [
        el('pre', { class: 'code-pre' }, [el('code', { text: read.text ?? '' })]),
      ]),
    );
    return nodes;
  }

  return {
    id: 'requirements',
    mount() {
      paint();
      if (!mounted) {
        mounted = true;
        void load();
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

function fact(label, value) {
  return el('div', {}, [el('dt', { text: label }), el('dd', { text: String(value ?? '') })]);
}
