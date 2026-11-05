/**
 * One answer to "which real file is this project-relative path", shared by the RPC file methods and
 * the byte route (U11). Two implementations would be two chances to miss a symlink escape.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { RpcError } from './rpc.ts';

/** Resolve a project-relative path, refusing anything that lands outside the project. */
export function resolveInsideProject(projectRoot: string, requested: string): string {
  const root = realpathSync(projectRoot);
  const target = join(root, requested);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  const inside = target === root || target.startsWith(prefix);
  if (!inside) {
    throw new RpcError('FORBIDDEN', `${requested} is not inside the project`, { path: requested });
  }
  if (!existsSync(target)) {
    return target;
  }
  const real = realpathSync(target);
  if (real !== root && !real.startsWith(prefix)) {
    throw new RpcError('FORBIDDEN', `${requested} resolves outside the project`, { path: requested });
  }
  return real;
}

export interface ProjectFileBytes {
  readonly bytes: Buffer;
  readonly size: number;
  readonly updatedAt: string;
  readonly mimeType: string;
}

/**
 * Read one project file for display or download. Symlinks are listed as themselves and never
 * followed: the project is what the user opened, not whatever a link points at.
 */
export function readProjectFileBytes(projectRoot: string, requested: string): ProjectFileBytes {
  const target = resolveInsideProject(projectRoot, requested);
  const info = statSync(target, { throwIfNoEntry: false });
  if (info === undefined || !info.isFile()) {
    throw new RpcError('NOT_FOUND', `${requested} is not a file in this project`, { path: requested });
  }
  return {
    bytes: readFileSync(target),
    size: info.size,
    updatedAt: info.mtime.toISOString(),
    mimeType: mimeTypeOf(requested),
  };
}

/** Display mime by extension. Anything unknown is octet-stream, which the viewer shows as bytes. */
export function mimeTypeOf(path: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
  return MIME[extension] ?? 'application/octet-stream';
}

const MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
};
