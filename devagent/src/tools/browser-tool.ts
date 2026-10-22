/**
 * `browser` (S8): one headless Chromium per session, driven by named actions.
 *
 * Why a tool instead of "write a Playwright script in bash": the tester and the developer both need
 * the same observation vocabulary (elements with stable refs, console, failed requests, a screenshot),
 * and every ad-hoc script would be re-derived per run. The product also has read-only roles with no
 * shell at all (reviewer, investigator), so a script is not an option for them.
 *
 * Deliberate limits:
 *  - headless Chromium only; the user's own browser and its logged-in state are never touched;
 *  - a browser is closed when the session asks, or after ten idle minutes;
 *  - in a read Task the tool refuses click/type/press, so "look at the page" cannot become a change.
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import { fail, messageOf, ok, readBoolean, readNumber, readString, type ToolOutcome } from './tool-kit.ts';
import type { DomainTool } from './task-tools.ts';
import { storeImage } from '../server/attachments.ts';

const ACTION_TIMEOUT_MS = 15_000;
const IDLE_CLOSE_MS = 10 * 60_000;
const MAX_ELEMENTS = 60;
const MAX_LOG_LINES = 50;
/** Actions that only look. Everything else needs a write Task. */
const READ_ONLY_ACTIONS: Record<string, true> = {
  open: true,
  observe: true,
  screenshot: true,
  console: true,
  network: true,
  close: true,
};

export interface BrowserToolOptions {
  /** Session this browser belongs to: one live Chromium per session. */
  readonly sessionId: string;
  /** Where screenshots are stored as attachments (the same store the chat uses). */
  readonly agentDir: string;
  /** A read Task observes a page and never acts on it. */
  readonly readOnly: boolean;
  /** The one seam tests replace: a fake page instead of a real Chromium. */
  readonly launcher?: () => Promise<BrowserHandle>;
}

export interface BrowserHandle {
  readonly browser: Pick<Browser, 'close'>;
  readonly page: Page;
  readonly console: Array<{ type: string; text: string }>;
  readonly responses: Array<{ method: string; url: string; status: number }>;
  readonly failures: Array<{ url: string; error: string }>;
  idleTimer?: NodeJS.Timeout;
}

const LIVE = new Map<string, BrowserHandle>();

/** Close one session's browser (the `close` action and tests). Safe when none is open. */
export async function closeBrowser(sessionId: string): Promise<void> {
  const handle = LIVE.get(sessionId);
  LIVE.delete(sessionId);
  if (handle === undefined) return;
  clearTimeout(handle.idleTimer);
  try {
    await handle.browser.close();
  } catch {
    // A browser that already died needs no further cleanup.
  }
}

/** Close every browser this process opened; used by shutdown and by tests. */
export async function closeAllBrowsers(): Promise<void> {
  for (const sessionId of [...LIVE.keys()]) {
    await closeBrowser(sessionId);
  }
}

async function launch(options: BrowserToolOptions): Promise<BrowserHandle> {
  if (options.launcher !== undefined) {
    return options.launcher();
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
  const handle: BrowserHandle = { browser, page, console: [], responses: [], failures: [] };
  page.on('console', (message) => {
    if (handle.console.length < MAX_LOG_LINES) {
      handle.console.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('response', (response) => {
    if (handle.responses.length < MAX_LOG_LINES) {
      handle.responses.push({
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
    }
  });
  page.on('requestfailed', (request) => {
    if (handle.failures.length < MAX_LOG_LINES) {
      handle.failures.push({ url: request.url(), error: request.failure()?.errorText ?? 'failed' });
    }
  });
  return handle;
}

async function handleFor(options: BrowserToolOptions): Promise<BrowserHandle> {
  const existing = LIVE.get(options.sessionId);
  if (existing !== undefined) {
    clearTimeout(existing.idleTimer);
    return existing;
  }
  const created = await launch(options);
  LIVE.set(options.sessionId, created);
  return created;
}

function armIdleClose(sessionId: string): void {
  const handle = LIVE.get(sessionId);
  if (handle === undefined) return;
  const timer = setTimeout(() => {
    void closeBrowser(sessionId);
  }, IDLE_CLOSE_MS);
  timer.unref?.();
  handle.idleTimer = timer;
}

const REF_PATTERN = /^e\d{1,4}$/;
/**
 * Schemes `open` may navigate to. `file:` is refused on purpose: a page loaded from disk can read
 * local files (credentials included) into the transcript, and the private-path guard only sees the
 * file tools. `data:` and `about:` stay allowed — they are how a page is inspected without a server.
 */
const ALLOWED_PROTOCOLS: Record<string, true> = { 'http:': true, 'https:': true, 'data:': true, 'about:': true };

/** The URL to navigate to, or undefined when the scheme is not one this tool may open. */
function navigableUrl(raw: string): string | undefined {
  try {
    const parsed = new URL(raw);
    return ALLOWED_PROTOCOLS[parsed.protocol] === true ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function selectorFor(ref: string): string | undefined {
  return REF_PATTERN.test(ref) ? `[data-agentdev-ref="${ref}"]` : undefined;
}

/**
 * Tag visible interactive elements with stable refs and describe them. The ref lives in the DOM, so
 * a click needs no selector guessing; navigation or a re-render invalidates it, which is why every
 * action that depends on one asks the model to observe again.
 */
const OBSERVE_SCRIPT = `(() => {
  const selector = 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[role="menuitem"],[contenteditable="true"]';
  for (const el of document.querySelectorAll('[data-agentdev-ref]')) el.removeAttribute('data-agentdev-ref');
  const elements = [];
  let index = 0;
  for (const el of document.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    index += 1;
    const ref = 'e' + index;
    el.setAttribute('data-agentdev-ref', ref);
    const tag = el.tagName.toLowerCase();
    const text = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || el.value || '').replace(/\\s+/g, ' ').trim();
    elements.push({
      ref,
      tag,
      type: el.getAttribute('type') || '',
      name: text.slice(0, 80),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    });
    if (elements.length >= ${MAX_ELEMENTS}) break;
  }
  return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : '').replace(/\\s+\\n/g, '\\n').slice(0, 4000), elements };
})()`;

interface Observation {
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly elements: Array<{
    readonly ref: string;
    readonly tag: string;
    readonly type: string;
    readonly name: string;
    readonly disabled: boolean;
    readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  }>;
}

function formatObservation(observation: Observation): string {
  const lines = [
    `url: ${observation.url}`,
    `title: ${observation.title}`,
    `elements: ${observation.elements.length}`,
    ...observation.elements.map(
      (element) =>
        `${element.ref} ${element.tag}${element.type === '' ? '' : `[${element.type}]`} ${JSON.stringify(element.name)}${element.disabled ? ' disabled' : ''} @${element.box.x},${element.box.y} ${element.box.w}x${element.box.h}`,
    ),
    '',
    'page text:',
    observation.text,
  ];
  return lines.join('\n');
}

async function observe(page: Page): Promise<Observation> {
  return (await page.evaluate(OBSERVE_SCRIPT)) as Observation;
}

export function createBrowserTool(options: BrowserToolOptions): DomainTool {
  return {
    name: 'browser',
    label: 'browser',
    description: [
      'Drive one headless Chromium page and collect real evidence: element refs, page text, screenshots, console output, failed requests.',
      'Always observe before acting: refs are only valid for the page you just observed, and a navigation invalidates them.',
      'A screenshot is saved as an attachment and also shown to you; cite its id or path in your report.',
      ...(options.readOnly
        ? ['This session is read-only: open/observe/screenshot/console/network/close only. It cannot click, type or press.']
        : []),
      'Use it to verify what the user would see, not to explore the open web: that is web_search/web_fetch.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'observe', 'click', 'type', 'press', 'wait', 'screenshot', 'console', 'network', 'close'],
        },
        url: { type: 'string', description: 'for open: the address to load (defaults to about:blank)' },
        ref: { type: 'string', description: 'for click/type: an element ref from the last observe' },
        text: { type: 'string', description: 'for type: the text to type; for wait: text that must appear' },
        key: { type: 'string', description: 'for press: a key name such as Enter or Tab' },
        selector: { type: 'string', description: 'for wait: a CSS selector that must appear' },
        fullPage: { type: 'boolean', description: 'for screenshot: capture the whole scrollable page' },
        timeoutMs: { type: 'number', description: 'for wait: how long to wait, default 15000' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_toolCallId, rawParams): Promise<ToolOutcome> {
      const params = (typeof rawParams === 'object' && rawParams !== null ? rawParams : {}) as Record<string, unknown>;
      const action = readString(params, 'action') ?? '';
      if (READ_ONLY_ACTIONS[action] !== true && options.readOnly) {
        return fail('FORBIDDEN', `this session may only observe a page (${action} is refused)`, { action });
      }
      if (action === 'close') {
        await closeBrowser(options.sessionId);
        return ok('browser closed', { action, sessionId: options.sessionId });
      }
      let handle: BrowserHandle;
      try {
        handle = await handleFor(options);
      } catch (error) {
        return fail(
          'BROWSER_UNAVAILABLE',
          `the browser could not be started (${messageOf(error)}). Install Chromium with "npx playwright install chromium", then retry.`,
          { action },
        );
      }
      try {
        if (action === 'open') {
          const requested = readString(params, 'url') ?? 'about:blank';
          const url = navigableUrl(requested);
          if (url === undefined) {
            return fail('INVALID_ARGUMENT', 'open accepts http, https, data or about URLs only', { action, url: requested });
          }
          await handle.page.goto(url, { waitUntil: 'load', timeout: ACTION_TIMEOUT_MS });
          armIdleClose(options.sessionId);
          const observation = await observe(handle.page);
          return ok(formatObservation(observation), {
            action,
            url: observation.url,
            title: observation.title,
            elements: observation.elements.length,
          });
        }
        if (action === 'observe') {
          const observation = await observe(handle.page);
          armIdleClose(options.sessionId);
          return ok(formatObservation(observation), {
            action,
            url: observation.url,
            title: observation.title,
            elements: observation.elements.length,
          });
        }
        if (action === 'click') {
          const selector = selectorFor(readString(params, 'ref') ?? '');
          if (selector === undefined) return fail('INVALID_ARGUMENT', 'click needs a valid ref from the last observe', { action });
          await handle.page.click(selector, { timeout: ACTION_TIMEOUT_MS });
          armIdleClose(options.sessionId);
          const observation = await observe(handle.page);
          return ok(`clicked. current page:\n${formatObservation(observation)}`, {
            action,
            url: observation.url,
            title: observation.title,
            elements: observation.elements.length,
          });
        }
        if (action === 'type') {
          const selector = selectorFor(readString(params, 'ref') ?? '');
          if (selector === undefined) return fail('INVALID_ARGUMENT', 'type needs a valid ref from the last observe', { action });
          const text = readString(params, 'text');
          if (text === undefined) return fail('INVALID_ARGUMENT', 'type needs text', { action });
          await handle.page.fill(selector, text, { timeout: ACTION_TIMEOUT_MS });
          armIdleClose(options.sessionId);
          return ok(`typed ${text.length} characters into ${readString(params, 'ref') ?? ''}`, { action });
        }
        if (action === 'press') {
          const key = readString(params, 'key');
          if (key === undefined || key === '') return fail('INVALID_ARGUMENT', 'press needs a key', { action });
          await handle.page.press('body', key, { timeout: ACTION_TIMEOUT_MS });
          armIdleClose(options.sessionId);
          return ok(`pressed ${key}`, { action });
        }
        if (action === 'wait') {
          const selector = readString(params, 'selector');
          const text = readString(params, 'text');
          if (selector === undefined && text === undefined) {
            return fail('INVALID_ARGUMENT', 'wait needs selector or text', { action });
          }
          const requested = readNumber(params, 'timeoutMs') ?? ACTION_TIMEOUT_MS;
          const timeout = Math.max(200, Math.min(60_000, Math.floor(requested)));
          try {
            if (selector !== undefined) {
              await handle.page.waitForSelector(selector, { timeout });
            } else {
              await handle.page.waitForFunction(
                `document.body && document.body.innerText.includes(${JSON.stringify(text ?? '')})`,
                undefined,
                { timeout },
              );
            }
          } catch (error) {
            return fail('INVALID_ARGUMENT', `wait timed out: ${messageOf(error)}`, { action, timeout });
          }
          armIdleClose(options.sessionId);
          return ok(`wait satisfied (${selector ?? text ?? ''})`, { action });
        }
        if (action === 'screenshot') {
          const fullPage = readBoolean(params, 'fullPage') === true;
          const bytes = await handle.page.screenshot({ type: 'png', fullPage });
          const stored = storeImage(options.agentDir, bytes);
          armIdleClose(options.sessionId);
          if (!stored.ok) {
            return fail('STORAGE_UNAVAILABLE', `the screenshot could not be stored: ${stored.message}`, { action });
          }
          const facts = `screenshot ${stored.image.id} (${bytes.byteLength} bytes, ${fullPage ? 'full page' : 'viewport'}) at ${handle.page.url()}`;
          return ok(facts, { action, attachmentId: stored.image.id, bytes: bytes.byteLength, url: handle.page.url() }, [
            { data: bytes.toString('base64'), mimeType: 'image/png' },
          ]);
        }
        if (action === 'console') {
          armIdleClose(options.sessionId);
          if (handle.console.length === 0) return ok('no console output', { action, lines: 0 });
          return ok(handle.console.map((line) => `${line.type}: ${line.text}`).join('\n'), {
            action,
            lines: handle.console.length,
          });
        }
        if (action === 'network') {
          armIdleClose(options.sessionId);
          const lines = [
            ...handle.responses.map((entry) => `${entry.status} ${entry.method} ${entry.url}`),
            ...handle.failures.map((entry) => `FAILED ${entry.url} (${entry.error})`),
          ];
          return ok(lines.length === 0 ? 'no requests recorded' : lines.join('\n'), {
            action,
            requests: handle.responses.length,
            failures: handle.failures.length,
          });
        }
        return fail('INVALID_ARGUMENT', `unknown action ${action}`, { action });
      } catch (error) {
        return fail('STORAGE_UNAVAILABLE', `the page action failed: ${messageOf(error)}`, { action });
      }
    },
  };
}
