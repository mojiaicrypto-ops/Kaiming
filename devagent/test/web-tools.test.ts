/**
 * The two web tools (S6/S7): the provider chain, the honest failure text, and the fetch cap that
 * keeps one documentation page from eating the context.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebSearchTool } from '../src/tools/web-search.ts';
import { createWebFetchTool, htmlToText } from '../src/tools/web-fetch.ts';
import { readCapped } from '../src/tools/http-body.ts';
import type { ToolOutcome } from '../src/tools/tool-kit.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'devagent-web-'));
  dirs.push(dir);
  return dir;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function text(body: string, contentType = 'text/html', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function textOf(outcome: ToolOutcome): string {
  return outcome.content.map((block) => block.text).join('\n');
}

describe('web_search', () => {
  it('uses the configured DeepSeek key first and prints each source with its URL', async () => {
    const calls: string[] = [];
    const tool = createWebSearchTool({
      modelKey: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test' },
      fetchImpl: async (url) => {
        calls.push(url);
        return json({
          results: [
            { title: 'Playwright Screenshots', url: 'https://playwright.dev/mcp/tools/screenshots', summary: 'Capture the viewport.', date: '2026-03-01' },
            { title: 'Second', url: 'https://example.com/b', snippet: 'other' },
          ],
        });
      },
    });
    const outcome = await tool.execute('c1', { query: 'playwright screenshot', limit: 5 });
    expect(outcome.isError).toBe(false);
    expect(calls[0]).toBe('https://api.deepseek.com/v1/tools/search');
    const body = textOf(outcome);
    expect(body).toContain('provider: deepseek');
    expect(body).toContain('[1] Playwright Screenshots (2026-03-01)');
    expect(body).toContain('https://playwright.dev/mcp/tools/screenshots');
    expect(body).toContain('Capture the viewport.');
    expect(outcome.details['provider']).toBe('deepseek');
  });

  it('falls back to the keyless DuckDuckGo page when the first provider fails', async () => {
    const tool = createWebSearchTool({
      modelKey: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test' },
      fetchImpl: async (url) => {
        if (url.includes('api.deepseek.com')) return json({ error: 'nope' }, 500);
        return text(`
          <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1">First <b>Result</b></a>
          <a class="result__snippet" href="#">The first snippet.</a>
          <a rel="nofollow" class="result__a" href="https://example.com/b">Second</a>
        `);
      },
    });
    const outcome = await tool.execute('c2', { query: 'anything' });
    expect(outcome.isError).toBe(false);
    expect(textOf(outcome)).toContain('provider: duckduckgo');
    expect(textOf(outcome)).toContain('https://example.com/a');
    expect(textOf(outcome)).toContain('https://example.com/b');
    expect(textOf(outcome)).toContain('First Result');
    expect(outcome.details['attempts']).toEqual(['deepseek: deepseek search returned 500']);
  });

  it('reports every failed provider instead of pretending there were no results', async () => {
    const tool = createWebSearchTool({
      modelKey: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test' },
      fetchImpl: async (url) => {
        if (url.includes('api.deepseek.com')) throw new Error('socket hang up');
        return text('<html><div class="anomaly-modal">captcha</div></html>');
      },
    });
    const outcome = await tool.execute('c3', { query: 'anything' });
    expect(outcome.isError).toBe(true);
    expect(outcome.details['code']).toBe('STORAGE_UNAVAILABLE');
    const body = textOf(outcome);
    expect(body).toContain('deepseek: socket hang up');
    expect(body).toContain('duckduckgo served a bot challenge');
  });

  it('requires a query and clamps the result count', async () => {
    const tool = createWebSearchTool({ fetchImpl: async () => json({ results: [] }) });
    await expect(tool.execute('c4', {})).resolves.toMatchObject({ isError: true });
    const clamped = await tool.execute('c5', {
      query: 'x',
      limit: 500,
    });
    expect(clamped.details['code']).toBeUndefined();
  });
});

describe('web_fetch', () => {
  it('returns a capped head and saves the whole text, so the rest can be grepped', async () => {
    const dir = workDir();
    const long = `<html><body><article><p>${'paragraph '.repeat(4000)}</p></article></body></html>`;
    const tool = createWebFetchTool({
      workDir: dir,
      fetchImpl: async () => text(long),
    });
    const outcome = await tool.execute('c1', { url: 'https://example.com/doc', maxChars: 1000 });
    expect(outcome.isError).toBe(false);
    const body = textOf(outcome);
    expect(body).toContain('content-type: text/html');
    const path = String(outcome.details['path']);
    expect(body).toContain(`saved: ${path}`);
    const saved = readFileSync(path, 'utf8');
    expect(saved.length).toBeGreaterThan(1000);
    expect(outcome.details['truncated']).toBe(true);
    // The model sees less than the file holds: that difference is the whole point of saving it.
    expect(body.length).toBeLessThan(saved.length);
    // The reported size is the saved text's size, not the HTML's.
    expect(outcome.details['chars']).toBe(saved.length);
  });

  it('refuses non-http URLs and non-text content types', async () => {
    const tool = createWebFetchTool({ workDir: workDir(), fetchImpl: async () => text('x') });
    expect((await tool.execute('c1', { url: 'file:///etc/passwd' })).details['code']).toBe('INVALID_ARGUMENT');
    expect((await tool.execute('c2', { url: 'not a url' })).details['code']).toBe('INVALID_ARGUMENT');
    const binary = createWebFetchTool({
      workDir: workDir(),
      fetchImpl: async () =>
        new Response(Buffer.from([0, 1, 2]), { headers: { 'content-type': 'application/octet-stream' } }),
    });
    expect((await binary.execute('c3', { url: 'https://example.com/x.bin' })).details['code']).toBe('INVALID_ARGUMENT');
    const rawTool = createWebFetchTool({
      workDir: workDir(),
      fetchImpl: async () => text('{"a":1}', 'application/json'),
    });
    const outcome = await rawTool.execute('c1', { url: 'https://api.example.com/x', raw: true });
    expect(textOf(outcome)).toContain('{"a":1}');
    const failing = createWebFetchTool({ workDir: workDir(), fetchImpl: async () => text('missing', 'text/plain', 404) });
    const failed = await failing.execute('c2', { url: 'https://example.com/gone' });
    expect(failed.isError).toBe(true);
    expect(failed.details['code']).toBe('NOT_FOUND');
  });

  it('caps a chunked body while reading instead of trusting content-length', async () => {
    // No content-length: a streamed response is exactly the case a header check misses.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    const response = new Response(stream);
    expect(response.headers.get('content-length')).toBeNull();
    expect(await readCapped(response, 10)).toBeUndefined();

    const ok = new Response(new Uint8Array(4));
    expect((await readCapped(ok, 10))?.byteLength).toBe(4);
  });

  it('reduces HTML to lines a model can read', () => {
    const out = htmlToText(
      '<html><head><title>t</title><script>var a = 1;</script></head><body><h1>Title</h1><p>One &amp; two</p><ul><li>a</li><li>b</li></ul></body></html>',
    );
    expect(out).toContain('Title');
    expect(out).toContain('One & two');
    expect(out).toContain('- a');
    expect(out).not.toContain('var a = 1;');
    expect(out).not.toContain('<');
  });
});
