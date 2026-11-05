/**
 * Paths and addresses the file viewer hands around. Kept apart from the component that draws it:
 * a caller that only needs "which directory does this file live in" must not import a view.
 */

/** The byte address of one project file: the viewer's own route, never a host path. */
export function bytesUrl(projectId: string, path: string): string {
  return `/api/v1/project-files/${encodeURIComponent(projectId)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function downloadUrl(projectId: string, path: string): string {
  return `${bytesUrl(projectId, path)}?download=1`;
}

/** The directory a path lives in; `.` is the root, which the server understands. */
export function parentOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '.' : parts.join('/');
}

/** The project-relative directory of a document, as a link base: '' is the project root. */
export function baseDirOf(path: string | null): string {
  if (path === null) return '';
  const parent = parentOf(path);
  return parent === '.' ? '' : parent;
}

/** Sizes the way a terminal prints them: no unit the reader has to convert in their head. */
export function bytes(size: number): string {
  if (size < 1024) return `${String(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
