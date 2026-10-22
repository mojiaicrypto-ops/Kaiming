/**
 * The browser tool (S8): the read-only rule, the ref-based actions, and screenshots that become
 * attachments. The page is faked here — a real Chromium launch is exercised by the smoke run, not by
 * the unit suite (a unit test must not need a downloaded browser).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { closeAllBrowsers, closeBrowser, createBrowserTool, type BrowserHandle } from '../src/tools/browser-tool.ts';
import { imageIdOf, readImage } from '../src/server/attachments.ts';
import type { ToolOutcome } from '../src/tools/tool-kit.ts';

const dirs: string[] = [];
afterEach(async () => {
  await closeAllBrowsers();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'devagent-browser-'));
  dirs.push(dir);
  return dir;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface FakeBrowser {
  readonly handle: BrowserHandle;
  readonly calls: string[];
  readonly closed: { count: number };
}

/** A page that records what it was asked to do; observation always reports one button. */
function fakeBrowser(): FakeBrowser {
  const calls: string[] = [];
  const closed = { count: 0 };
  const page = {
    goto: async (url: string) => {
      calls.push(`goto ${url}`);
    },
    url: () => 'http://127.0.0.1:5173/',
    title: async () => 'App',
    evaluate: async (script: string) => {
      calls.push(`evaluate ${script.includes('data-agentdev-ref') ? 'observe' : 'other'}`);
      return {
        url: 'http://127.0.0.1:5173/',
        title: 'App',
        text: 'hello',
        elements: [{ ref: 'e1', tag: 'button', type: '', name: 'Send', disabled: false, box: { x: 1, y: 2, w: 3, h: 4 } }],
      };
    },
    click: async (selector: string) => {
      calls.push(`click ${selector}`);
    },
    fill: async (selector: string, value: string) => {
      calls.push(`fill ${selector} ${value}`);
    },
    press: async (selector: string, key: string) => {
      calls.push(`press ${selector} ${key}`);
    },
    waitForSelector: async (selector: string) => {
      calls.push(`wait ${selector}`);
    },
    waitForFunction: async () => {
      calls.push('wait text');
    },
    screenshot: async () => PNG,
    on: () => undefined,
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
  } as unknown as Page;
  return {
    handle: {
      browser: {
        close: async () => {
          closed.count += 1;
        },
      },
      page,
      console: [],
      responses: [],
      failures: [],
    },
    calls,
    closed,
  };
}

function makeTool(options: {
  readonly sessionId: string;
  readonly dir?: string;
  readonly readOnly?: boolean;
  readonly handle?: BrowserHandle;
  readonly fail?: boolean;
}) {
  return createBrowserTool({
    sessionId: options.sessionId,
    agentDir: options.dir ?? agentDir(),
    readOnly: options.readOnly === true,
    launcher: async () => {
      if (options.fail === true) {
        throw new Error("Executable doesn't exist: chromium");
      }
      return options.handle ?? fakeBrowser().handle;
    },
  });
}

function textOf(outcome: ToolOutcome): string {
  return outcome.content.map((block) => block.text).join('\n');
}

describe('browser tool', () => {
  it('refuses every acting action in a read Task, even before a browser exists', async () => {
    let launched = 0;
    const browser = createBrowserTool({
      sessionId: 'read-1',
      agentDir: agentDir(),
      readOnly: true,
      launcher: async () => {
        launched += 1;
        return fakeBrowser().handle;
      },
    });
    for (const action of ['click', 'type', 'press']) {
      const outcome = await browser.execute('c1', { action, ref: 'e1', text: 'x', key: 'Enter' });
      expect(outcome.isError).toBe(true);
      expect(outcome.details['code']).toBe('FORBIDDEN');
    }
    expect(launched).toBe(0);
    // Observation stays available: that is how a reviewer looks at a running app.
    const observe = await browser.execute('c2', { action: 'observe' });
    expect(observe.isError).toBe(false);
    expect(launched).toBe(1);
  });

  it('opens a page, lists elements with refs, and acts only on a ref it handed out', async () => {
    const fake = fakeBrowser();
    const browser = makeTool({ sessionId: 's-1', handle: fake.handle });
    const opened = await browser.execute('c1', { action: 'open', url: 'http://127.0.0.1:5173/' });
    expect(opened.isError).toBe(false);
    expect(textOf(opened)).toContain('e1 button "Send"');
    expect(textOf(opened)).toContain('page text:');
    expect(fake.calls).toContain('goto http://127.0.0.1:5173/');

    const clicked = await browser.execute('c2', { action: 'click', ref: 'e1' });
    expect(clicked.isError).toBe(false);
    expect(fake.calls).toContain('click [data-agentdev-ref="e1"]');

    const typed = await browser.execute('c3', { action: 'type', ref: 'e1', text: 'hi' });
    expect(typed.isError).toBe(false);
    expect(fake.calls).toContain('fill [data-agentdev-ref="e1"] hi');

    // A value that is not a ref is refused, not guessed as a selector.
    const badRef = await browser.execute('c4', { action: 'click', ref: 'div:nth-child(2)' });
    expect(badRef.details['code']).toBe('INVALID_ARGUMENT');
  });

  it('stores a screenshot as an attachment, shows it to the model, and names its id', async () => {
    const dir = agentDir();
    const browser = makeTool({ sessionId: 's-2', dir });
    const outcome = await browser.execute('c1', { action: 'screenshot', fullPage: true });
    expect(outcome.isError).toBe(false);
    expect(outcome.images).toHaveLength(1);
    expect(outcome.images?.[0]?.mimeType).toBe('image/png');
    expect(outcome.details['attachmentId']).toBe(imageIdOf(PNG));
    expect(readImage(dir, imageIdOf(PNG))?.bytes.equals(PNG)).toBe(true);
    expect(textOf(outcome)).toContain(imageIdOf(PNG));
  });

  it('reports a missing browser instead of pretending the page was seen', async () => {
    const browser = makeTool({ sessionId: 's-3', fail: true });
    const outcome = await browser.execute('c1', { action: 'open', url: 'http://127.0.0.1:5173/' });
    expect(outcome.isError).toBe(true);
    expect(outcome.details['code']).toBe('BROWSER_UNAVAILABLE');
    expect(textOf(outcome)).toContain('npx playwright install chromium');
  });

  it('closes the browser when asked, and a second close is harmless', async () => {
    const fake = fakeBrowser();
    const browser = makeTool({ sessionId: 's-4', handle: fake.handle });
    await browser.execute('c1', { action: 'observe' });
    const outcome = await browser.execute('c2', { action: 'close' });
    expect(outcome.isError).toBe(false);
    expect(fake.closed.count).toBe(1);
    await expect(closeBrowser('s-4')).resolves.toBeUndefined();
    expect(fake.closed.count).toBe(1);
  });

  it('refuses to open a local file, so a read-only session cannot read the server private storage', async () => {
    const fake = fakeBrowser();
    const browser = makeTool({ sessionId: 's-6', handle: fake.handle, readOnly: true });
    const refused = await browser.execute('c1', { action: 'open', url: 'file:///etc/passwd' });
    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('INVALID_ARGUMENT');
    expect(fake.calls.some((call) => call.startsWith('goto '))).toBe(false);
    // data: and about: stay available: that is how a page is inspected without a server.
    expect((await browser.execute('c2', { action: 'open', url: 'about:blank' })).isError).toBe(false);
    expect(fake.calls).toContain('goto about:blank');
  });

  it('rejects an unknown action', async () => {
    const browser = makeTool({ sessionId: 's-5' });
    const outcome = await browser.execute('c1', { action: 'teleport' });
    expect(outcome.details['code']).toBe('INVALID_ARGUMENT');
  });
});
