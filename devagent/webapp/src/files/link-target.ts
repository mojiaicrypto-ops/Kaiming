/**
 * Where a link in a report actually points.
 *
 * The workbench never rewrites the file it is reading: a report keeps the paths its author wrote.
 * Agents write what they see in their own working directory, which is the project's real path on
 * this machine (`/Users/…/aisuangua/.dev/work/t-x/shots/a.png`). The browser cannot open that —
 * `/Users/…` is not a route — so the decision is made at click time, from the path itself, against
 * the project root the shell already knows. No rewriting, no second copy of the text.
 */
export type LinkTarget =
  /** A real URL: hand it to the browser, in its own tab. */
  | { readonly kind: 'external'; readonly href: string }
  /** A fragment inside the current document: let the browser scroll. */
  | { readonly kind: 'anchor' }
  /** A file inside the open project, as a project-relative path. */
  | { readonly kind: 'project'; readonly path: string }
  /** A host path that is not inside this project: the viewer cannot reach it, and says so. */
  | { readonly kind: 'outside'; readonly path: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolve one `href` written in a document.
 *
 * `projectRealPath` is the project's own absolute path (what the server opened); `baseDir` is the
 * project-relative directory of the document that holds the link, so `./shots/a.png` in
 * `.dev/work/t-x/r1.md` means `.dev/work/t-x/shots/a.png`.
 */
export function resolveLink(href: string, projectRealPath: string, baseDir = ''): LinkTarget {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return { kind: 'anchor' };

  // A `file://` URL is a host path with a scheme: read it as a path, not as something to fetch.
  if (trimmed.startsWith('file://')) {
    return classifyAbsolute(decodeURIComponent(trimmed.slice('file://'.length)), projectRealPath);
  }
  if (SCHEME.test(trimmed)) return { kind: 'external', href: trimmed };
  if (trimmed.startsWith('/')) return classifyAbsolute(trimmed, projectRealPath);
  return classifyRelative(trimmed, baseDir);
}

/** An absolute path: project-relative when it lives under the project root, otherwise outside. */
function classifyAbsolute(path: string, projectRealPath: string): LinkTarget {
  const root = normalizeAbsolute(projectRealPath);
  const full = normalizeAbsolute(path);
  if (root !== '' && full !== root && full.startsWith(`${root}/`)) {
    return { kind: 'project', path: full.slice(root.length + 1) };
  }
  if (root !== '' && full === root) return { kind: 'project', path: '.' };
  return { kind: 'outside', path: full };
}

/** A relative path: joined to the document's own directory, and never above the project root. */
function classifyRelative(path: string, baseDir: string): LinkTarget {
  const parts = baseDir.split('/').filter((part) => part !== '' && part !== '.');
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      // Walking above the root is not a file in this project: it is a path the reader cannot open,
      // and pretending otherwise would silently read a different file.
      if (parts.length === 0) return { kind: 'outside', path: path };
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return { kind: 'project', path: parts.join('/') };
}

function normalizeAbsolute(path: string): string {
  const parts: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return `/${parts.join('/')}`;
}

/** The `href` of the anchor a click landed on, if it landed on one. */
export function hrefOfEvent(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  const anchor = target.closest('a[href]');
  if (anchor === null) return undefined;
  return anchor.getAttribute('href') ?? undefined;
}
