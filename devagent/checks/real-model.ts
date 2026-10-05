/**
 * Real-model check (run manually, needs credentials in devagent/config/model.json).
 *
 * It answers the two questions the design could only answer with a stub:
 *  1. does a real model actually use the ported `question` tool, and does the host answer reach it?
 *  2. do the adapter-shape facts hold end to end with a real model — `notify` survives the SDK's
 *     uiContext wrapping, the terminal-only surface fails with the adapter's own error, and the
 *     absent theme stays absent?
 *
 * Not part of `npm test`: it needs the network and a paid endpoint.
 */
import { type AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { createHostUi } from '../spikes/harness/host-ui.ts';
import { loadModelConfig } from '../spikes/harness/model-config.ts';
import { createStubEnv, openSession } from '../spikes/harness/pi-env.ts';
import { createQuestionTool } from '../spikes/harness/question-tool.ts';

const loaded = loadModelConfig();
if (!loaded.ok) {
  console.error(`real-model check cannot start: ${loaded.error}`);
  process.exit(1);
}
const { config } = loaded;
for (const [key, value] of Object.entries(config.env)) {
  process.env[key] = value;
}

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
};

const env = await createStubEnv(undefined, { providers: config.providers });
const adapter = createHostUi([{ kind: 'select', value: 'B' }]);
const toolResults: string[] = [];
const startedAt = Date.now();

try {
  const { session } = await openSession(env, {
    providerId: config.provider,
    modelId: config.model,
    tools: ['question'],
    extensionFactories: [
      (pi) => pi.registerTool(createQuestionTool(() => adapter.lastInteractionId())),
    ],
  });
  session.subscribe((event: AgentSessionEvent) => {
    if (event.type === 'message_end' && event.message.role === 'toolResult') {
      toolResults.push(
        event.message.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
      );
    }
  });
  await session.bindExtensions({ uiContext: adapter, mode: 'rpc' });

  const model = session.model;
  console.log(`model: ${model?.provider ?? 'unknown'}/${model?.id ?? 'unknown'}`);

  await session.prompt(
    '请调用 question 工具向我提问一次：method 用 select，title 用 "请选择"，options 用 ["A","B"]。' +
      '等我回答之后，用一句话明确告诉我我选的是哪一个选项。不要使用其它工具。',
  );
  const elapsedMs = Date.now() - startedAt;

  const lastMessage = session.messages[session.messages.length - 1];
  const stopReason = lastMessage?.role === 'assistant' ? lastMessage.stopReason : 'none';
  const providerError =
    lastMessage?.role === 'assistant' ? String(lastMessage.errorMessage ?? '') : '';
  const finalText = session.getLastAssistantText() ?? '';
  const toolText = toolResults[toolResults.length - 1] ?? '';

  check(
    'real model is reachable and the run finished normally',
    lastMessage?.role === 'assistant' && stopReason !== 'error' && finalText.length > 0,
    `stopReason=${stopReason} elapsedMs=${elapsedMs} providerError=${JSON.stringify(providerError.slice(0, 200))} text=${JSON.stringify(finalText.slice(0, 120))}`,
  );
  check(
    'real model used the ported question tool exactly once (select)',
    adapter.requests.length === 1 && adapter.requests[0]?.method === 'select',
    `requests=${adapter.requests.length} methods=[${adapter.requests.map((request) => request.method).join(',')}] options=[${adapter.requests[0]?.options?.join(',') ?? ''}]`,
  );
  check(
    'host answer reached the real model',
    finalText.includes('B'),
    `finalText=${JSON.stringify(finalText.slice(0, 160))}`,
  );
  check(
    'adapter-shape facts hold with a real model: notify survives, TUI-only fails loudly, theme absent',
    toolText.includes('notify=ok') &&
      toolText.includes('tuiError=getAllThemes(): the browser host has no Pi TUI surface') &&
      toolText.includes('themeAbsent=true') &&
      adapter.notifications.length === 1,
    `toolText=${JSON.stringify(toolText.slice(0, 200))} notifications=${adapter.notifications.length}`,
  );
  session.dispose();
} finally {
  await env.cleanup();
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} real-model checks passed`);
if (failed.length > 0) {
  process.exitCode = 1;
}