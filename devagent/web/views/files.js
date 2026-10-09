/**
 * Files view (the mock's file browser): a directory tree built lazily from `project.files.list` (one
 * call per directory, paginated to completion) and a read-only preview from `project.files.read`.
 *
 * The search box filters the tree that is already loaded - it never triggers a server query - and the
 * preview reports the real size, sha256 version and the truncated/binary states instead of guessing.
 */
import { el, qs, replace } from '../core/dom.js';

const MAX_PAGES = 200;

export function createFilesView(context) {
  const { store, i18n, toast } = context;
  const tree = qs('#fileTree');
  const emptyNote = qs('#fileTreeEmpty');
  const search = qs('#fileSearch');
  const pathLabel = qs('#filePath');
  const metaLabel = qs('#fileMeta');
  const lineLabel = qs('#fileLineCount');
  const code = qs('#fileCode');
  const countLabel = qs('#visibleFileCount');
  const t = (key) => i18n.t(key);

  // Our own container inside #fileTree, so the shell's #fileTreeEmpty stays where it is.
  const root = tree === null ? null : el('div', { class: 'file-tree-root' });
  if (tree !== null) {
    tree.append(root);
    if (pathLabel !== null) {
      pathLabel.textContent = t('files.select');
    }
  }

  let loaded = false;
  let activePath = null;

  const unsubscribe = store.subscribe('project', () => {
    loaded = false;
    activePath = null;
    void loadRoot();
  });

  async function listDirectory(path) {
    const entries = [];
    let cursor;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = { projectId: store.projectId, path };
      const read = await store.rpc.call(
        'project.files.list',
        cursor === undefined ? params : { ...params, cursor },
      );
      entries.push(...read.entries);
      if (read.nextCursor === null || read.nextCursor === undefined) {
        break;
      }
      cursor = read.nextCursor;
    }
    return entries;
  }

  async function loadRoot() {
    if (root === null || loaded) {
      return;
    }
    loaded = true;
    replace(root, el('p', { class: 'file-tree-empty', text: t('common.loading') }));
    if (store.projectId === null) {
      replace(root, el('p', { class: 'file-tree-empty', text: t('files.noProject') }));
      return;
    }
    try {
      const entries = await listDirectory('.');
      renderEntries(entries);
    } catch (failure) {
      replace(root, el('p', { class: 'file-tree-empty', text: failure?.message ?? String(failure) }));
    }
  }

  function renderEntries(entries) {
    if (entries.length === 0) {
      replace(root, el('p', { class: 'file-tree-empty', text: t('files.dirEmpty') }));
    } else {
      replace(root, ...entries.map(makeNode));
    }
    applySearch();
    if (activePath !== null) {
      const active = root.querySelector(`.file-item[data-path="${cssEscape(activePath)}"]`);
      active?.classList.add('active');
    }
  }

  function makeNode(entry) {
    return entry.type === 'directory' ? makeDirectory(entry) : makeFile(entry);
  }

  function makeFile(entry) {
    return el(
      'button',
      {
        class: 'file-item',
        type: 'button',
        role: 'treeitem',
        dataset: { path: entry.path, nameLower: entry.name.toLowerCase() },
        onclick: (event) => void openFile(entry, event.currentTarget),
      },
      [
        el('span', { class: 'file-kind', text: kindOf(entry.name) }),
        el('span', { class: 'file-name', text: entry.name }),
      ],
    );
  }

  function makeDirectory(entry) {
    const children = el('div', { class: 'tree-children' });
    const details = el(
      'details',
      { dataset: { path: entry.path, nameLower: entry.name.toLowerCase() } },
      [el('summary', {}, [el('span', { class: 'file-name', text: entry.name })]), children],
    );
    let expanded = false;
    details.addEventListener('toggle', () => {
      if (details.open && !expanded) {
        expanded = true;
        void loadChildren(entry.path, children);
      }
    });
    return details;
  }

  async function loadChildren(path, container) {
    replace(container, el('p', { class: 'file-tree-empty', text: t('common.loading') }));
    try {
      const entries = await listDirectory(path);
      if (entries.length === 0) {
        replace(container, el('p', { class: 'file-tree-empty', text: t('files.dirEmpty') }));
      } else {
        replace(container, ...entries.map(makeNode));
      }
      applySearch();
    } catch (failure) {
      replace(container, el('p', { class: 'file-tree-empty', text: failure?.message ?? String(failure) }));
    }
  }

  async function openFile(entry, button) {
    try {
      const read = await store.rpc.call('project.files.read', {
        projectId: store.projectId,
        path: entry.path,
      });
      activePath = read.path;
      for (const item of root.querySelectorAll('.file-item.active')) {
        item.classList.remove('active');
      }
      button?.classList.add('active');
      if (pathLabel !== null) {
        pathLabel.textContent = read.path;
      }
      if (metaLabel !== null) {
        const parts = [kindOf(read.path), formatSize(read.size), String(read.version ?? '').slice(0, 12)];
        if (read.binary === true) {
          parts.push(t('files.binaryTag'));
        }
        if (read.truncated === true) {
          parts.push(t('files.truncated'));
        }
        metaLabel.textContent = parts.filter(Boolean).join(' · ');
      }
      if (code !== null) {
        code.textContent = read.binary === true ? t('files.binary') : (read.text ?? '');
      }
      if (lineLabel !== null) {
        const lines = read.binary === true ? 0 : String(read.text ?? '').split('\n').length;
        lineLabel.textContent = t('files.lines').replace('{count}', String(lines));
      }
    } catch (failure) {
      toast.error(failure?.message ?? String(failure));
    }
  }

  function applySearch() {
    if (root === null) {
      return;
    }
    const query = (search?.value ?? '').trim().toLowerCase();
    for (const item of root.querySelectorAll('.file-item')) {
      item.hidden = !(query === '' || (item.dataset.nameLower ?? '').includes(query));
    }
    const visit = (container) => {
      let visible = 0;
      for (const child of Array.from(container.children)) {
        if (child.tagName === 'DETAILS') {
          const children = child.querySelector(':scope > .tree-children');
          const inner = children === null ? 0 : visit(children);
          const selfMatch = query !== '' && (child.dataset.nameLower ?? '').includes(query);
          const show = query === '' || selfMatch || inner > 0;
          child.hidden = !show;
          if (query !== '' && (selfMatch || inner > 0)) {
            child.open = true;
          }
          if (show) {
            visible += 1;
          }
        } else if (child.classList.contains('file-item') && !child.hidden) {
          visible += 1;
        }
      }
      return visible;
    };
    visit(root);
    const visibleNodes = root.querySelectorAll('.file-item:not([hidden]), details:not([hidden])').length;
    if (emptyNote !== null) {
      emptyNote.hidden = !(query !== '' && visibleNodes === 0);
    }
    if (countLabel !== null) {
      countLabel.textContent = String(root.querySelectorAll('.file-item:not([hidden])').length);
    }
  }

  search?.addEventListener('input', () => applySearch());

  return {
    id: 'files',
    mount() {
      void loadRoot();
    },
    update() {},
    destroy() {
      unsubscribe();
    },
  };
}

function kindOf(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  return match === null ? '' : match[1].slice(0, 3).toUpperCase();
}

function formatSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}
