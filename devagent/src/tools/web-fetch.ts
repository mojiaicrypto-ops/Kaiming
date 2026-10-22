/**
 * `web_fetch` (S7): turn a URL into text the model can actually use.
 *
 * Pi's own `read` is a filesystem tool, so without this a model that finds a documentation page can
 * only pipe `curl` through the shell and receive raw markup. One measured example: a Playwright API
 * page is 975 KB of HTML and 158 K characters of prose — roughly 40 K tokens, i.e. most of a small
 * context for one page. So the tool returns the head of the text and writes the whole of it to a
 * file, and the model reads the part it needs with `grep`/`read`.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, messageOf, ok, readBoolean, readNumber, readString, type ToolOutcome } from './tool-kit.ts';
import type { DomainTool } from './task-tools.ts';
import { readCapped } from './http-body.ts';

const DEFAULT_MAX_CHARS = 20_000;
const MAX_CHARS = 60_000;
/** A page bigger than this is not a page we are willing to read into memory. */
const MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface WebFetchOptions {
  /** Absolute directory for the saved full text (`<agentDir>/work/<sessionId>/web`). */
  readonly workDir: string;
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&');
}

/**
 * HTML → readable text. Deliberately small: remove what is never prose, keep block boundaries as
 * newlines, strip the rest of the markup. It is not a renderer and does not try to be — the model
 * gets lines it can grep.
 */
export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|pre|blockquote|table)>/gi, '\n')
    .replace(/<(li|tr)\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * A stable file name for the saved page: the URL's own digest, so the same page is one file. A
 * 32-bit hash is not enough here — two different URLs sharing a name would silently overwrite one
 * page's text with another's.
 */
function fileNameFor(url: string): string {
  return `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.txt`;
}

export function createWebFetchTool(options: WebFetchOptions): DomainTool {
  const fetchImpl = (options.fetchImpl ?? fetch) as typeof fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    name: 'web_fetch',
    label: 'web_fetch',
    description: [
      'Fetch one URL and return its readable text.',
      'HTML is reduced to prose; the complete text is saved to a file whose path is returned, so use grep/read on it when the answer is past the returned head.',
      'Only http and https. Never invent a URL: search first, then fetch the result you saw.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'absolute http(s) URL' },
        maxChars: { type: 'number', description: `characters returned inline, default ${DEFAULT_MAX_CHARS}, max ${MAX_CHARS}` },
        raw: { type: 'boolean', description: 'keep the response body as-is instead of extracting text (for JSON or plain text)' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams): Promise<ToolOutcome> {
      const params = (typeof rawParams === 'object' && rawParams !== null ? rawParams : {}) as Record<string, unknown>;
      const raw = readString(params, 'url')?.trim() ?? '';
      if (raw === '') {
        return fail('INVALID_ARGUMENT', 'url is required');
      }
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return fail('INVALID_ARGUMENT', `not a URL: ${raw}`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return fail('INVALID_ARGUMENT', 'only http and https URLs can be fetched');
      }
      const requested = readNumber(params, 'maxChars') ?? DEFAULT_MAX_CHARS;
      const maxChars = Math.max(1_000, Math.min(MAX_CHARS, Math.floor(requested)));
      const keepRaw = readBoolean(params, 'raw') === true;

      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          redirect: 'follow',
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return fail('STORAGE_UNAVAILABLE', `the page could not be fetched: ${messageOf(error)}`, { url: url.toString() });
      }
      if (!response.ok) {
        return fail('NOT_FOUND', `the server answered ${response.status}`, { url: url.toString(), status: response.status });
      }
      const contentType = response.headers.get('content-type') ?? '';
      const isText =
        keepRaw ||
        contentType === '' ||
        contentType.includes('text/') ||
        contentType.includes('json') ||
        contentType.includes('xml') ||
        contentType.includes('javascript');
      if (!isText) {
        return fail('INVALID_ARGUMENT', `unsupported content type: ${contentType || 'unknown'}`, {
          url: url.toString(),
          contentType,
        });
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > MAX_BYTES) {
        return fail('INVALID_ARGUMENT', `the page is larger than ${MAX_BYTES} bytes`, {
          url: url.toString(),
          bytes: declared,
        });
      }
      let body: Buffer | undefined;
      try {
        // The header may lie or be absent (chunked): the cap is enforced while reading.
        body = await readCapped(response, MAX_BYTES);
      } catch (error) {
        return fail('STORAGE_UNAVAILABLE', `the page body could not be read: ${messageOf(error)}`, { url: url.toString() });
      }
      if (body === undefined) {
        return fail('INVALID_ARGUMENT', `the page is larger than ${MAX_BYTES} bytes`, { url: url.toString(), limit: MAX_BYTES });
      }
      const decoded = body.toString('utf8');
      const isHtml = !keepRaw && (contentType.includes('html') || /^\s*<!doctype html|^\s*<html/i.test(decoded));
      const text = isHtml ? htmlToText(decoded) : decoded;

      // Save the whole text first: a head that the model cannot follow up on is worse than useless.
      const path = join(options.workDir, fileNameFor(url.toString()));
      try {
        mkdirSync(options.workDir, { recursive: true });
        writeFileSync(path, text, 'utf8');
      } catch (error) {
        return fail('STORAGE_UNAVAILABLE', `the page text could not be saved: ${messageOf(error)}`, { path });
      }

      const head = text.slice(0, maxChars);
      const truncated = text.length > head.length;
      const facts = [
        `url: ${url.toString()}`,
        `content-type: ${contentType || 'unknown'}`,
        `bytes: ${body.byteLength}`,
        `chars: ${text.length}`,
        `saved: ${path}`,
        ...(truncated ? [`truncated: showing the first ${head.length} characters; grep or read the saved file for the rest`] : []),
      ].join('\n');
      return ok(`${facts}\n\n${head}`, {
        url: url.toString(),
        contentType,
        bytes: body.byteLength,
        chars: text.length,
        path,
        truncated,
      });
    },
  };
}
