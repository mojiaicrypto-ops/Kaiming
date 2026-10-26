/**
 * What kind of file this is, decided by its name alone. The viewer has exactly five ways to show
 * something, and every one of them is "the file itself, as it is": source text, an image, a media
 * player, a notice that the bytes are not displayable, or a download.
 *
 * There is no sixth kind. Nothing here is rendered AS a document: an `.html` file is source text
 * like any other, because this is a file viewer, not a page host.
 */
export type FileKind = 'text' | 'image' | 'video' | 'audio' | 'binary';

/** Extensions that always open as bytes, whatever their content looks like. */
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);
/** Not text, and no browser-native way to show it inline: the viewer offers the download instead. */
const OPAQUE = new Set(['pdf', 'zip', 'gz', 'tgz', 'tar', 'mgz', '7z', 'rar', 'woff', 'woff2', 'ttf', 'otf', 'exe', 'dmg', 'bin', 'so', 'dylib', 'a', 'o', 'wasm']);

export function extensionOf(path: string): string {
  return /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? '';
}

/** A document read formatted; the only kind that is not shown as source by default. */
export function isMarkdown(path: string): boolean {
  const extension = extensionOf(path);
  return extension === 'md' || extension === 'markdown' || extension === 'mdx';
}

export function fileKindOf(path: string): FileKind {
  const extension = extensionOf(path);
  if (IMAGE.has(extension)) return 'image';
  if (VIDEO.has(extension)) return 'video';
  if (AUDIO.has(extension)) return 'audio';
  if (OPAQUE.has(extension)) return 'binary';
  // Everything else is read as text. An unknown extension that turns out to hold binary bytes is
  // caught by the server's own check, which is the only place that sees the content.
  return 'text';
}

/**
 * The highlight.js language for a path, when one is registered. `undefined` means "no colouring",
 * never "guess": a wrong grammar produces misleading colours, which is worse than plain text.
 */
export function languageOf(path: string): string | undefined {
  const extension = extensionOf(path);
  if (extension === '') {
    return /(^|\/)(dockerfile|makefile|procfile)$/i.test(path) ? 'dockerfile' : undefined;
  }
  return LANGUAGE_OF_EXTENSION[extension];
}

const LANGUAGE_OF_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'json',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};
