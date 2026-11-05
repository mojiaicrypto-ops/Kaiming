/**
 * `web_search` (S6): one query, one answer, from whichever provider this installation can really
 * reach. Ordered by cost to the user: the model key they already configured (DeepSeek), then the
 * keyless DuckDuckGo page, then optional Brave/Tavily keys.
 *
 * The tool never throws for a provider problem: it returns `Error: ...` with the provider it tried,
 * so a model can say "search failed" instead of inventing a result. Sources are quoted with their
 * URL because an external fact without a source is not evidence.
 */
import { fail, messageOf, ok, readNumber, readString, type ToolOutcome } from './tool-kit.ts';
import type { DomainTool } from './task-tools.ts';
import { readCapped } from './http-body.ts';

export interface SearchSource {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly published?: string;
}

export interface SearchAnswer {
  readonly provider: string;
  readonly sources: readonly SearchSource[];
}

export interface WebSearchOptions {
  /** The chat provider's own search endpoint, when the configured provider is DeepSeek. */
  readonly modelKey?: { readonly baseUrl: string; readonly apiKey: string };
  /** Credentials that are only read when present; nothing is required. */
  readonly env?: NodeJS.ProcessEnv;
  /** The one network seam tests replace. */
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

const SNIPPET_LIMIT = 240;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
/** A search page that exceeds this is not a result page. */
const SEARCH_PAGE_MAX_BYTES = 4 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function clip(text: string, limit = SNIPPET_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Strip tags from one search-result fragment; the DDG page is HTML. */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** DeepSeek's `/v1/tools/search`: the same key the chat model uses. */
async function searchDeepSeek(
  query: string,
  limit: number,
  key: { baseUrl: string; apiKey: string },
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<SearchAnswer> {
  const base = key.baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  const response = await fetchImpl(`${base}/v1/tools/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key.apiKey}` },
    body: JSON.stringify({ query, count: limit }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`deepseek search returned ${response.status}`);
  }
  const body = (await response.json()) as { results?: unknown };
  const results = Array.isArray(body.results) ? body.results : [];
  const sources: SearchSource[] = [];
  for (const item of results) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const url = typeof record['url'] === 'string' ? record['url'] : undefined;
    if (url === undefined) continue;
    sources.push({
      title: typeof record['title'] === 'string' ? record['title'] : url,
      url,
      snippet: clip(
        typeof record['summary'] === 'string'
          ? record['summary']
          : typeof record['snippet'] === 'string'
            ? record['snippet']
            : '',
      ),
      ...(typeof record['date'] === 'string' && record['date'] !== '' ? { published: record['date'] } : {}),
    });
  }
  return { provider: 'deepseek', sources };
}

/**
 * DuckDuckGo's no-JavaScript page. Keyless, so it is the fallback when no credential exists; its
 * HTML is stable enough to parse by class prefix, and a challenge page is reported as a failure
 * rather than returned as "no results".
 */
async function searchDuckDuckGo(
  query: string,
  limit: number,
  recency: string | undefined,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<SearchAnswer> {
  const form = new URLSearchParams({ q: query });
  if (recency === 'day' || recency === 'week' || recency === 'month' || recency === 'year') {
    form.set('df', recency === 'day' ? 'd' : recency === 'week' ? 'w' : recency === 'month' ? 'm' : 'y');
  }
  const response = await fetchImpl('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
    body: form.toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`duckduckgo search returned ${response.status}`);
  }
  const bytes = await readCapped(response, SEARCH_PAGE_MAX_BYTES);
  if (bytes === undefined) {
    throw new Error('the duckduckgo page is larger than expected');
  }
  const html = bytes.toString('utf8');
  if (html.includes('anomaly-modal')) {
    throw new Error('duckduckgo served a bot challenge');
  }
  const sources: SearchSource[] = [];
  const pattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const href = decodeEntities(match[1] ?? '');
    const url = href.includes('uddg=')
      ? (new URL(href.startsWith('//') ? `https:${href}` : href, 'https://duckduckgo.com').searchParams.get('uddg') ?? href)
      : href;
    if (!/^https?:\/\//.test(url)) continue;
    sources.push({ title: stripTags(match[2] ?? ''), url, snippet: '' });
    if (sources.length >= limit) break;
  }
  // Snippets follow their result in the page; pair the first N snippets in order, which is exact
  // for the standard layout and harmless (an empty snippet) when the layout differs.
  const snippets = [...html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((match) =>
    clip(stripTags(match[1] ?? '')),
  );
  return {
    provider: 'duckduckgo',
    sources: sources.map((source, index) => ({ ...source, snippet: snippets[index] ?? '' })),
  };
}

export function formatSearchAnswer(answer: SearchAnswer): string {
  if (answer.sources.length === 0) {
    return `No results (provider: ${answer.provider}).`;
  }
  const lines = answer.sources.map((source, index) => {
    const age = source.published !== undefined ? ` (${source.published})` : '';
    const snippet = source.snippet === '' ? '' : `\n    ${source.snippet}`;
    return `[${index + 1}] ${source.title}${age}\n    ${source.url}${snippet}`;
  });
  return [`provider: ${answer.provider}`, ...lines].join('\n');
}

export function createWebSearchTool(options: WebSearchOptions = {}): DomainTool {
  const fetchImpl = (options.fetchImpl ?? fetch) as typeof fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    name: 'web_search',
    label: 'web_search',
    description: [
      'Search the public web and get titles, URLs and snippets.',
      'Use it for external facts: library/API documentation, version notes, error messages, standards.',
      'It never reads a page: call web_fetch on a result URL for the content.',
      'Report what you found with its URL; a claim without a source is not evidence.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'search query; site:, after: and quoted phrases are passed through when supported' },
        limit: { type: 'number', description: `how many results, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}` },
        recency: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'prefer recent results' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams): Promise<ToolOutcome> {
      const params = (typeof rawParams === 'object' && rawParams !== null ? rawParams : {}) as Record<string, unknown>;
      const query = readString(params, 'query')?.trim() ?? '';
      if (query === '') {
        return fail('INVALID_ARGUMENT', 'query is required');
      }
      if (query.length > 400) {
        return fail('INVALID_ARGUMENT', 'the query is too long (400 characters)');
      }
      const requested = readNumber(params, 'limit') ?? DEFAULT_LIMIT;
      const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(requested)));
      const recency = readString(params, 'recency');
      const env = options.env ?? process.env;
      const attempts: string[] = [];

      const providers: Array<{ name: string; run: () => Promise<SearchAnswer> }> = [];
      const modelKey = options.modelKey;
      if (modelKey !== undefined && modelKey.apiKey !== '') {
        providers.push({ name: 'deepseek', run: () => searchDeepSeek(query, limit, modelKey, fetchImpl, timeoutMs) });
      }
      if (env['BRAVE_API_KEY'] !== undefined && env['BRAVE_API_KEY'] !== '') {
        providers.push({
          name: 'brave',
          run: async () => {
            const url = new URL('https://api.search.brave.com/res/v1/web/search');
            url.searchParams.set('q', query);
            url.searchParams.set('count', String(limit));
            const response = await fetchImpl(url.toString(), {
              headers: { 'x-subscription-token': env['BRAVE_API_KEY'] ?? '', accept: 'application/json' },
              signal: AbortSignal.timeout(timeoutMs),
            });
            if (!response.ok) throw new Error(`brave search returned ${response.status}`);
            const body = (await response.json()) as { web?: { results?: unknown } };
            const results = Array.isArray(body.web?.results) ? body.web?.results ?? [] : [];
            const sources: SearchSource[] = [];
            for (const item of results) {
              if (typeof item !== 'object' || item === null) continue;
              const record = item as Record<string, unknown>;
              if (typeof record['url'] !== 'string') continue;
              sources.push({
                title: typeof record['title'] === 'string' ? record['title'] : record['url'],
                url: record['url'],
                snippet: clip(typeof record['description'] === 'string' ? record['description'] : ''),
                ...(typeof record['age'] === 'string' ? { published: record['age'] } : {}),
              });
            }
            return { provider: 'brave', sources };
          },
        });
      }
      providers.push({
        name: 'duckduckgo',
        run: () => searchDuckDuckGo(query, limit, recency, fetchImpl, timeoutMs),
      });

      for (const provider of providers) {
        try {
          const answer = await provider.run();
          return ok(formatSearchAnswer(answer), { provider: answer.provider, sources: answer.sources, attempts });
        } catch (error) {
          attempts.push(`${provider.name}: ${messageOf(error)}`);
        }
      }
      return fail('STORAGE_UNAVAILABLE', `web search failed (${attempts.join('; ')})`, { attempts });
    },
  };
}
