/**
 * Reference parsing and resolution (BF-5). A reference is `[scheme:]location[#heading]`; only the
 * repository scheme exists in this version. Version is the Git blob hash for a tracked, clean file
 * and the content sha256 otherwise — the same value the caller can quote as "what I read".
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface ParsedRef {
  readonly scheme: 'repo';
  readonly path: string;
  readonly heading?: string;
}

export interface ResolvedRef {
  readonly ref: string;
  readonly exists: boolean;
  readonly text?: string;
  readonly heading?: string;
  /** Present when a heading was requested: whether that heading text exists in the target. */
  readonly headingFound?: boolean;
  readonly version?: string;
  /** Why the reference could not be used at all (unsupported scheme, escaping path). */
  readonly error?: string;
}

const SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/**
 * Parse a reference. Unknown schemes and paths that would leave the project are refused: they are
 * argument errors, not "missing files".
 */
export function parseRef(ref: string): ParsedRef {
  const trimmed = ref.trim();
  if (trimmed === '') {
    throw new Error('引用不能为空');
  }
  const schemeMatch = SCHEME_PATTERN.exec(trimmed);
  let rest = trimmed;
  if (schemeMatch !== null) {
    const scheme = (schemeMatch[1] ?? '').toLowerCase();
    if (scheme !== 'repo') {
      throw new Error(`不支持的引用类型：${scheme}`);
    }
    rest = trimmed.slice(schemeMatch[0].length);
  }
  const hashIndex = rest.indexOf('#');
  const rawPath = (hashIndex >= 0 ? rest.slice(0, hashIndex) : rest).trim();
  const heading = hashIndex >= 0 ? rest.slice(hashIndex + 1).trim() : '';
  if (rawPath === '') {
    throw new Error('引用缺少路径');
  }
  if (isAbsolute(rawPath)) {
    throw new Error('引用必须使用项目相对路径');
  }
  const normalized = rawPath.replace(/^\.\//, '');
  if (normalized === '' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('引用不能越出项目目录');
  }
  return {
    scheme: 'repo',
    path: normalized,
    ...(heading === '' ? {} : { heading }),
  };
}

function insideProject(cwd: string, target: string): boolean {
  const rel = relative(resolve(cwd), target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The recorded version of a file: the Git blob hash when the file is tracked and unchanged, the
 * content sha256 otherwise. Any Git failure (not a repository, binary missing) falls back silently:
 * a version is still recorded, it just cannot claim to be the committed blob.
 */
function versionOf(cwd: string, projectPath: string, text: string): string {
  try {
    const status = execFileSync('git', ['status', '--porcelain', '--', projectPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (status.trim() !== '') {
      return sha256(text);
    }
    execFileSync('git', ['ls-files', '--error-unmatch', '--', projectPath], {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const blob = execFileSync('git', ['hash-object', '--', projectPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const value = blob.trim();
    return value === '' ? sha256(text) : value;
  } catch {
    return sha256(text);
  }
}

function headingExists(text: string, heading: string): boolean {
  const wanted = heading.trim();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (match !== null && (match[1] ?? '').trim() === wanted) {
      return true;
    }
  }
  return false;
}

/** Resolve a reference against a project directory. Never throws for a missing target. */
export function resolveRef(projectCwd: string, ref: string): ResolvedRef {
  let parsed: ParsedRef;
  try {
    parsed = parseRef(ref);
  } catch (error) {
    return { ref, exists: false, error: error instanceof Error ? error.message : String(error) };
  }
  const target = resolve(projectCwd, parsed.path);
  if (!insideProject(projectCwd, target)) {
    return { ref, exists: false, error: '引用不能越出项目目录' };
  }
  let isFile = false;
  try {
    isFile = existsSync(target) && statSync(target).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    return {
      ref,
      exists: false,
      ...(parsed.heading === undefined
        ? {}
        : { heading: parsed.heading, headingFound: false }),
    };
  }
  let text: string;
  try {
    text = readFileSync(target, 'utf8');
  } catch {
    return { ref, exists: false };
  }
  return {
    ref,
    exists: true,
    text,
    ...(parsed.heading === undefined
      ? {}
      : { heading: parsed.heading, headingFound: headingExists(text, parsed.heading) }),
    version: versionOf(projectCwd, parsed.path, text),
  };
}
