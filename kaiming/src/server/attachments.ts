/**
 * Attachments (U6): the image and document storage this product has. There is no cloud service,
 * so bytes live on disk, addressed by their own digest:
 *
 *   <agentDir>/attachments/<sha256[:32]>
 *
 * Content addressing is what makes the three writers agree without a database row: the upload
 * route, a Pi image block read back from a session file, and a browser screenshot all name the same
 * bytes with the same id. Writing twice is a no-op, and a message can never point at a file that the
 * same bytes did not produce.
 *
 * Images are accepted by magic bytes. Documents are accepted by a known extension (PDF, DOCX,
 * PPTX, XLSX, ODT/ODS/ODP, RTF, EPUB, TeX and text-like research files) and their extracted text is
 * kept in a sidecar beside the original bytes. The id comes from the bytes, never from the client,
 * so a request cannot choose a path.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isUtf8 } from 'node:buffer';
import { OfficeParser, type SupportedFileType } from 'officeparser';
import { extname, join } from 'node:path';

/** One image's ceiling. Large enough for a full-resolution screenshot, small enough to stay a message. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** One document's ceiling. R&D PDFs and office files are often larger than screenshots. */
export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
/** The upload route's ceiling: the larger of the two, decided per bytes. */
export const MAX_ATTACHMENT_BYTES = MAX_DOCUMENT_BYTES;
/** How many attachments one user input may carry. */
export const MAX_ATTACHMENTS_PER_INPUT = 6;
/** Backwards-compatible name used by image-only callers. */
export const MAX_IMAGES_PER_INPUT = MAX_ATTACHMENTS_PER_INPUT;

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

export const IMAGE_MIME_TYPES: readonly ImageMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

export interface StoredImage {
  readonly id: string;
  readonly mimeType: ImageMimeType;
  readonly bytes: number;
}

export interface StoredDocument {
  readonly id: string;
  readonly kind: 'document';
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly extractedChars: number;
  readonly truncated: boolean;
}

export type StoredAttachment =
  | ({ readonly kind: 'image' } & StoredImage)
  | StoredDocument;

export type StoreImageResult =
  | { readonly ok: true; readonly image: StoredImage }
  | { readonly ok: false; readonly code: 'INVALID_ARGUMENT' | 'TOO_LARGE'; readonly message: string };

export type StoreDocumentResult =
  | { readonly ok: true; readonly document: StoredDocument }
  | { readonly ok: false; readonly code: 'INVALID_ARGUMENT' | 'TOO_LARGE'; readonly message: string };

const ID_PATTERN = /^[0-9a-f]{32}$/;
const MAX_DOCUMENT_CHARS = 200_000;
const DOCUMENT_META_SUFFIX = '.json';

/** Research files that are text in their own right; no document parser is involved. */
const TEXT_EXTENSIONS: Readonly<Record<string, true>> = {
  txt: true, text: true, md: true, markdown: true, mdx: true, csv: true, tsv: true,
  json: true, jsonl: true, ndjson: true, yaml: true, yml: true, xml: true, html: true,
  htm: true, css: true, scss: true, less: true, js: true, mjs: true, cjs: true, jsx: true,
  ts: true, tsx: true, py: true, java: true, kt: true, kts: true, go: true, rs: true,
  rb: true, php: true, sh: true, bash: true, zsh: true, fish: true, sql: true, toml: true,
  ini: true, cfg: true, conf: true, properties: true, env: true, log: true, diff: true,
  patch: true, tex: true, proto: true, graphql: true, gql: true, svelte: true, vue: true,
  dart: true, swift: true, scala: true, lua: true, r: true, bat: true, ps1: true,
};

/** Office/PDF formats parsed by officeparser. Legacy binary .doc/.xls/.ppt are not claimable. */
const OFFICE_EXTENSIONS: Readonly<Record<string, true>> = {
  pdf: true, docx: true, pptx: true, xlsx: true, odt: true, ods: true, odp: true, rtf: true, epub: true,
};

const MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdx: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  ndjson: 'application/x-ndjson',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  sql: 'application/sql',
  toml: 'application/toml',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  properties: 'text/plain',
  env: 'text/plain',
  log: 'text/plain',
  diff: 'text/x-diff',
  patch: 'text/x-diff',
  tex: 'application/x-tex',
  txt: 'text/plain',
  text: 'text/plain',
};


export function attachmentsDir(agentDir: string): string {
  return join(agentDir, 'attachments');
}

/** The id is the first 128 bits of the digest: collision-free in practice, short enough to quote. */
export function imageIdOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32);
}

export function attachmentIdOf(bytes: Uint8Array): string {
  return imageIdOf(bytes);
}

/**
 * Identify the format from the bytes, not from a declared type: a client cannot label HTML as an
 * image and have the server believe it.
 */
export function sniffImageMime(bytes: Uint8Array): ImageMimeType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

/** Persist bytes and return the id every reader will use. Idempotent. */
export function storeImage(agentDir: string, bytes: Uint8Array): StoreImageResult {
  if (bytes.length === 0) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: 'the image is empty' };
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, code: 'TOO_LARGE', message: `the image is larger than ${MAX_IMAGE_BYTES} bytes` };
  }
  const mimeType = sniffImageMime(bytes);
  if (mimeType === undefined) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: 'only png, jpeg, webp or gif images are accepted' };
  }
  const id = imageIdOf(bytes);
  writeImmutable(agentDir, id, bytes);
  return { ok: true, image: { id, mimeType, bytes: bytes.length } };
}

/** A filename is presentation metadata, never a path. Windows separators count too. */
export function safeDocumentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'document';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return cleaned === '' ? 'document' : cleaned;
}

export function documentExtension(name: string): string {
  return extname(safeDocumentName(name)).replace(/^\./, '').toLowerCase();
}

export function isDocumentName(name: string): boolean {
  const extension = documentExtension(name);
  return extension !== '' && (TEXT_EXTENSIONS[extension] === true || OFFICE_EXTENSIONS[extension] === true);
}

export function documentMimeType(name: string): string {
  const extension = documentExtension(name);
  return MIME[extension] ?? 'application/octet-stream';
}

/** A parser error is not a client error if the document is simply scanned or encrypted. */
function parserMessage(name: string): string {
  return `could not extract text from ${safeDocumentName(name)}; scanned PDFs and encrypted or unsupported documents are not accepted`;
}

/** Extract text without trusting the declared MIME type; the extension only chooses the parser. */
async function extractDocumentText(
  bytes: Uint8Array,
  name: string,
  extension: string,
): Promise<{ readonly text: string; readonly mimeType: string }> {
  if (TEXT_EXTENSIONS[extension] === true || (extension === '' && isUtf8(bytes) && !bytes.includes(0))) {
    if (bytes.includes(0) || !isUtf8(bytes)) {
      throw new Error(parserMessage(name));
    }
    return { text: Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, ''), mimeType: documentMimeType(name) };
  }
  if (OFFICE_EXTENSIONS[extension] !== true) {
    // A known text file with an unusual extension still works when its bytes really are UTF-8.
    if (isUtf8(bytes) && !bytes.includes(0)) {
      return { text: Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, ''), mimeType: 'text/plain' };
    }
    throw new Error(
      `unsupported document type .${extension || '(none)'}; attach PDF, DOCX, PPTX, XLSX, ODT/ODS/ODP, RTF, EPUB, TeX or a text/code file`,
    );
  }
  try {
    const ast = await OfficeParser.parseOffice(bytes, { fileType: extension as SupportedFileType });
    const rendered = await ast.to('text');
    const value = typeof rendered === 'string' ? rendered : (rendered as { value?: unknown } | null)?.value;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(parserMessage(name));
    }
    return { text: value, mimeType: documentMimeType(name) };
  } catch {
    throw new Error(parserMessage(name));
  }
}

/**
 * Store a document's original bytes and their extracted text. The upload is refused if no text can
 * be extracted, because a model cannot receive an opaque binary and silently pretending it can is
 * worse than saying so.
 */
export async function storeDocument(
  agentDir: string,
  bytes: Uint8Array,
  name: string,
): Promise<StoreDocumentResult> {
  if (bytes.length === 0) {
    return { ok: false, code: 'INVALID_ARGUMENT', message: 'the document is empty' };
  }
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, code: 'TOO_LARGE', message: `the document is larger than ${MAX_DOCUMENT_BYTES} bytes` };
  }
  const safeName = safeDocumentName(name);
  const extension = documentExtension(safeName);
  let extracted: { text: string; mimeType: string };
  try {
    extracted = await extractDocumentText(bytes, safeName, extension);
  } catch (error) {
    return {
      ok: false,
      code: 'INVALID_ARGUMENT',
      message: error instanceof Error ? error.message : parserMessage(safeName),
    };
  }
  const truncated = extracted.text.length > MAX_DOCUMENT_CHARS;
  const text = truncated
    ? `${extracted.text.slice(0, MAX_DOCUMENT_CHARS)}\n\n[document truncated after ${MAX_DOCUMENT_CHARS} characters]`
    : extracted.text;
  const id = attachmentIdOf(bytes);
  writeImmutable(agentDir, id, bytes);
  const metaPath = join(attachmentsDir(agentDir), `${id}${DOCUMENT_META_SUFFIX}`);
  if (!existsSync(metaPath)) {
    const temp = `${metaPath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, JSON.stringify({ kind: 'document', name: safeName, mimeType: extracted.mimeType, text, truncated }));
    renameSync(temp, metaPath);
  }
  return {
    ok: true,
    document: {
      id,
      kind: 'document',
      name: safeName,
      mimeType: extracted.mimeType,
      bytes: bytes.length,
      extractedChars: Math.min(extracted.text.length, MAX_DOCUMENT_CHARS),
      truncated,
    },
  };
}

function writeImmutable(agentDir: string, id: string, bytes: Uint8Array): void {
  const dir = attachmentsDir(agentDir);
  const path = join(dir, id);
  if (existsSync(path)) return;
  mkdirSync(dir, { recursive: true });
  // A concurrent writer (two projections of the same image) may create it first; the temp name is
  // per process and per call, so the rename stays atomic and the last writer wins with equal bytes.
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, bytes);
  renameSync(temp, path);
}

export function imagePath(agentDir: string, id: string): string | undefined {
  if (!ID_PATTERN.test(id)) return undefined;
  return join(attachmentsDir(agentDir), id);
}

export function documentMetaPath(agentDir: string, id: string): string | undefined {
  if (!ID_PATTERN.test(id)) return undefined;
  return join(attachmentsDir(agentDir), `${id}${DOCUMENT_META_SUFFIX}`);
}

export function readImage(agentDir: string, id: string): { readonly mimeType: ImageMimeType; readonly bytes: Buffer } | undefined {
  const path = imagePath(agentDir, id);
  if (path === undefined || !existsSync(path)) return undefined;
  const bytes = readFileSync(path);
  const mimeType = sniffImageMime(bytes);
  if (mimeType === undefined) return undefined;
  return { mimeType, bytes };
}

export interface DocumentText {
  readonly name: string;
  readonly mimeType: string;
  readonly text: string;
  readonly truncated: boolean;
}

/** The extracted text of one stored document, or undefined when the id is not a document. */
export function readDocument(agentDir: string, id: string): DocumentText | undefined {
  const metaPath = documentMetaPath(agentDir, id);
  if (metaPath === undefined || !existsSync(metaPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    if (parsed['kind'] !== 'document' || typeof parsed['text'] !== 'string') return undefined;
    return {
      name: typeof parsed['name'] === 'string' ? parsed['name'] : id,
      mimeType: typeof parsed['mimeType'] === 'string' ? parsed['mimeType'] : 'application/octet-stream',
      text: parsed['text'],
      truncated: parsed['truncated'] === true,
    };
  } catch {
    return undefined;
  }
}

/** Any stored attachment, for the byte route and for submit validation. */
export function readAttachment(agentDir: string, id: string): StoredAttachment | undefined {
  const image = readImage(agentDir, id);
  if (image !== undefined) {
    return { kind: 'image', id, mimeType: image.mimeType, bytes: image.bytes.length };
  }
  const document = readDocument(agentDir, id);
  if (document === undefined) return undefined;
  return {
    kind: 'document',
    id,
    name: document.name,
    mimeType: document.mimeType,
    bytes: readAttachmentBytes(agentDir, id)?.length ?? 0,
    extractedChars: document.text.length,
    truncated: document.truncated,
  };
}


export function readAttachmentBytes(agentDir: string, id: string): Buffer | undefined {
  const path = imagePath(agentDir, id);
  if (path === undefined || !existsSync(path)) return undefined;
  return readFileSync(path);
}


/** Store bytes that arrived as base64 inside a session file; returns the id or undefined. */
export function storeBase64Image(agentDir: string, data: string): { readonly id: string; readonly mimeType: ImageMimeType } | undefined {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(data, 'base64');
  } catch {
    return undefined;
  }
  if (bytes.length === 0) return undefined;
  const stored = storeImage(agentDir, bytes);
  if (!stored.ok) return undefined;
  return { id: stored.image.id, mimeType: stored.image.mimeType };
}
