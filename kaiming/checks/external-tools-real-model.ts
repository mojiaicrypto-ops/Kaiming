/**
 * Real-model check for the three external tools and image input (needs kaiming/config/model.json).
 *
 * `npm run check:tools` runs the whole path with the real provider: the model decides to call
 * `web_search`, `browser` and `web_fetch`, the host executes them, and this script reads the session
 * file to confirm what really happened. A model that ignores the tools is a FAIL with its own answer
 * printed — the check never claims a tool ran when it did not.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { loadModelConfig } from '../spikes/harness/model-config.ts';
import { createStubEnv } from '../spikes/harness/pi-env.ts';
import { resolveEffectiveConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';
import { InputRunner } from '../src/runtime/runner.ts';
import { readPiHistory, type HistoryRecord } from '../src/server/history.ts';
import { readImage, storeImage } from '../src/server/attachments.ts';
import { closeAllBrowsers } from '../src/tools/browser-tool.ts';
import { Store } from '../src/store/store.ts';

const loaded = loadModelConfig();
if (!loaded.ok) {
  console.error(`external-tools check cannot start: ${loaded.error}`);
  process.exit(1);
}
const { config } = loaded;
for (const [key, value] of Object.entries(config.env)) {
  process.env[key] = value;
}

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'technicalnew', 'prompts');
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
};

const agentEnv = await createStubEnv(undefined, { providers: config.providers });
const workspace = mkdtempSync(join(tmpdir(), 'kaiming-tools-real-'));
const store = new Store({ path: join(workspace, 'state.db'), serverEpoch: 1 });
let inputSeq = 0;

/** Text of one history record, and the ids of any images it carries. */
function contentOf(record: HistoryRecord): { text: string; images: string[] } {
  const blocks = Array.isArray(record.content) ? (record.content as Array<Record<string, unknown>>) : [];
  return {
    text: blocks
      .filter((block) => block['type'] === 'text' && typeof block['text'] === 'string')
      .map((block) => String(block['text']))
      .join('\n'),
    images: blocks.flatMap((block) => (block['type'] === 'image' && typeof block['id'] === 'string' ? [block['id']] : [])),
  };
}

try {
  store.createProject({ id: 'p-1', realPath: workspace });
  store.createSession({ id: 's-1', projectId: 'p-1', roleId: 'chief', cwd: workspace });
  const defaults: RuntimeDefaults = {
    model: { providerId: config.provider, modelId: config.model },
    agentDir: agentEnv.agentDir,
    promptDir: PROMPT_DIR,
    tools: [],
  };
  const factory = new PiRuntimeFactory(defaults);
  const runner = new InputRunner({
    store,
    registry: new SessionRegistry(factory),
    factory,
    resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server: defaults }),
  });

  /** Run one input and return the newest tool results and the last assistant text. */
  const run = async (content: Array<Record<string, unknown>>): Promise<{ results: HistoryRecord[]; answer: string }> => {
    inputSeq += 1;
    const inputId = `i-${inputSeq}`;
    store.acceptInput({
      inputId,
      projectId: 'p-1',
      sessionId: 's-1',
      sourceKey: `user:r-${inputSeq}`,
      requestKey: `r-${inputSeq}`,
      method: 'session.input.submit',
      kind: 'user',
      payload: { content },
    });
    const outcome = await runner.runNext('s-1');
    if (outcome.kind !== 'completed') {
      throw new Error(`input ${inputId} ended as ${outcome.kind}: ${'detail' in outcome ? outcome.detail : ''}`);
    }
    const binding = store.getSessionBinding('s-1');
    const history = readPiHistory(binding?.piFile, agentEnv.agentDir);
    const since = history.records.filter((record) => record.inputId === inputId);
    const results = since.filter((record) => record.role === 'toolResult');
    const assistant = since.filter((record) => record.role === 'assistant').at(-1);
    return { results, answer: assistant === undefined ? '' : contentOf(assistant).text };
  };

  // 1. web_search with the configured model key.
  const search = await run([
    {
      type: 'text',
      text: '必须调用 web_search 工具查询 "playwright screenshot api"，然后只回答你找到的一个官方文档 URL。不要凭记忆回答。',
    },
  ]);
  const searchCall = search.results.find((record) => record.toolName === 'web_search');
  const searchText = searchCall === undefined ? '' : contentOf(searchCall).text;
  check(
    'the model called web_search and the tool returned real sources',
    searchCall !== undefined && /https?:\/\//.test(searchText) && !searchCall.isError,
    `${searchCall === undefined ? 'no web_search call' : searchText.split('\n').slice(0, 2).join(' | ')} :: answer=${search.answer.slice(0, 80)}`,
  );

  // 2. web_fetch on a local page the model cannot know from memory.
  const fetch = await run([
    {
      type: 'text',
      text: '必须调用 web_fetch 工具读取 http://127.0.0.1:1/never —— 如果失败，原样告诉我工具返回的错误码，不要换成别的工具。',
    },
  ]);
  const fetchCall = fetch.results.find((record) => record.toolName === 'web_fetch');
  check(
    'the model called web_fetch and the host reported the failure honestly',
    fetchCall !== undefined && fetchCall.isError === true,
    fetchCall === undefined ? 'no web_fetch call' : contentOf(fetchCall).text.slice(0, 120),
  );

  // 3. browser: open a data URL, observe, then screenshot.
  const browse = await run([
    {
      type: 'text',
      text:
        '必须依次调用 browser 工具：先用 action=open 打开 "data:text/html,<h1>Smoke</h1><button>OnlyButton</button>"，' +
        '再用 action=screenshot 截一张图。最后只回答按钮上的文字。',
    },
  ]);
  const browserCalls = browse.results.filter((record) => record.toolName === 'browser');
  const observed = browserCalls.some((record) => contentOf(record).text.includes('OnlyButton'));
  const screenshot = browserCalls.flatMap((record) => contentOf(record).images);
  const storedShot = screenshot.find((id) => readImage(agentEnv.agentDir, id) !== undefined);
  check(
    'the model drove the browser, read the page, and the screenshot is stored and shown',
    browserCalls.length > 0 && observed && storedShot !== undefined && /OnlyButton/.test(browse.answer),
    `calls=${browserCalls.length} observed=${observed} screenshots=${screenshot.length} answer=${browse.answer.slice(0, 60)}`,
  );

  // 4. image input: the model receives base64 bytes the user attached.
  const paint = await chromium.launch({ headless: true });
  const paintPage = await paint.newPage({ viewport: { width: 64, height: 64 } });
  await paintPage.setContent('<body style="margin:0"><div style="width:64px;height:64px;background:#e01010"></div></body>');
  const redPng = await paintPage.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } });
  await paint.close();
  const stored = storeImage(agentEnv.agentDir, redPng);
  if (!stored.ok) throw new Error(`could not store the test image: ${stored.message}`);
  const vision = await run([
    { type: 'text', text: '这张图片主要是什么颜色？只回答一个颜色词。' },
    { type: 'image', attachmentId: stored.image.id },
  ]);
  check(
    'the model received the uploaded image and described it',
    /red|红/i.test(vision.answer),
    `attachment=${stored.image.id} answer=${vision.answer.slice(0, 80)}`,
  );
} catch (error) {
  check('the check ran to completion', false, error instanceof Error ? error.message : String(error));
} finally {
  await closeAllBrowsers();
  store.close();
  rmSync(workspace, { recursive: true, force: true });
  // Screenshots and uploads live under the throwaway agent dir, so they leave with it.
  rmSync(agentEnv.root, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(
  `\n${checks.length - failed.length}/${checks.length} checks passed (provider ${config.provider}/${config.model})`,
);
process.exit(failed.length === 0 ? 0 : 1);
