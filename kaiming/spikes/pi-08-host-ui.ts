/**
 * PI-08 (host interaction round-trip): the browser host declares itself an interactive host and
 * serves confirm/select/input through its own UI adapter, so the ported `question` tool can hand a
 * real user decision back to the model.
 *
 * Proves:
 *  A. with an interactive mode declared, confirm/select/input reach the host adapter with the real
 *     request content, and the model-visible tool result carries the host interactionId + answer;
 *  B. a selected value is returned as the chosen option; a cancelled select/input becomes undefined
 *     and a cancelled confirm becomes false;
 *  C. the session is occupied while the tool runs, and still occupied while the host answer is
 *     pending (sampled during the awaited round-trip, not only at tool entry);
 *  D. the real gate is binding a UI adapter: with one bound, confirm/select/input work even when the
 *     declared mode is "print"; with none bound, the same tool gets no UI and reports that plainly;
 *  E. the question tool is registered exactly once;
 *  F. the bound `ctx.ui` keeps its whole surface (the SDK wraps it by object spread, so `notify`
 *     must survive), the terminal-only members fail with the adapter's own message, and the absent
 *     theme stays absent.
 */
import { type AgentSessionEvent, type InlineExtension } from '@earendil-works/pi-coding-agent';
import {
  createHostUi,
  type ScriptedAnswer,
} from './harness/host-ui.ts';
import { createQuestionTool } from '../src/tools/question-tool.ts';
import { createChecker, createStubEnv, openSession, startStubModelServer } from './harness/pi-env.ts';

const checker = createChecker();

function questionCall(args: Record<string, unknown>): {
  kind: 'tool_calls';
  calls: Array<{ name: string; arguments: string }>;
} {
  return { kind: 'tool_calls', calls: [{ name: 'question', arguments: JSON.stringify(args) }] };
}

interface ToolObservation {
  readonly isError: boolean;
  readonly text: string;
}

const collectToolResults =
  (target: ToolObservation[]) =>
  (event: AgentSessionEvent): void => {
    if (event.type !== 'message_end' || event.message.role !== 'toolResult') {
      return;
    }
    target.push({
      isError: event.message.isError === true,
      text: event.message.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
    });
  };

// --- A/B/C/E: interactive host (mode=rpc) -------------------------------------------------
const server = await startStubModelServer([
  questionCall({ method: 'confirm', title: '继续吗？', message: '这里是模型提供的问题内容' }),
  { kind: 'text', text: 'confirm-done' },
  questionCall({ method: 'select', title: '选一个', options: ['A', 'B'] }),
  { kind: 'text', text: 'select-done' },
  questionCall({ method: 'select', title: '会被取消', options: ['A', 'B'] }),
  { kind: 'text', text: 'cancel-done' },
  questionCall({ method: 'input', title: '输入内容', placeholder: '请填写' }),
  { kind: 'text', text: 'input-done' },
]);
const env = await createStubEnv(server.baseUrl);
const answers: ScriptedAnswer[] = [
  { kind: 'confirm', value: true },
  { kind: 'select', value: 'B' },
  { kind: 'select', value: undefined },
  { kind: 'input', value: 'typed text' },
];
const adapter = createHostUi(answers, 25);
const extension: InlineExtension = (pi) => {
  pi.registerTool(createQuestionTool(() => adapter.lastInteractionId()));
};
const observations: ToolObservation[] = [];

try {
  const { session } = await openSession(env, {
    tools: ['question'],
    extensionFactories: [extension],
  });
  session.subscribe((event) => collectToolResults(observations)(event));
  await session.bindExtensions({ uiContext: adapter, mode: 'rpc' });

  let idleDuringWait: boolean | undefined;
  for (const label of ['confirm', 'select', 'cancel', 'input']) {
    if (label === 'confirm') {
      // Hold the first interaction open long enough to sample the session state while it waits.
      const pending = session.prompt(`ask via ${label}`);
      for (let attempt = 0; attempt < 500 && adapter.requests.length === 0; attempt += 1) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 2);
        await promise;
      }
      idleDuringWait = session.isIdle;
      await pending;
      continue;
    }
    await session.prompt(`ask via ${label}`);
  }

  const activeQuestionTools = session.getActiveToolNames().filter((name) => name === 'question');
  checker.check(
    'E: the question tool is registered and active exactly once',
    activeQuestionTools.length === 1,
    `active=[${session.getActiveToolNames().join(',')}] questionCount=${activeQuestionTools.length}`,
  );

  const methods = adapter.requests.map((request) => request.method).join(',');
  checker.check(
    'A: host adapter received the real requests through the SDK ui channel',
    methods === 'confirm,select,select,input' &&
      adapter.requests[0]?.message === '这里是模型提供的问题内容' &&
      adapter.requests[1]?.options?.join(',') === 'A,B' &&
      adapter.requests[3]?.placeholder === '请填写',
    `methods=[${methods}] confirmMessage=${JSON.stringify(adapter.requests[0]?.message)} selectOptions=[${adapter.requests[1]?.options?.join(',')}] inputPlaceholder=${JSON.stringify(adapter.requests[3]?.placeholder)}`,
  );

  const answersSeen = observations.map((observation) => observation.text);
  checker.check(
    'B: chosen value, cancellation and text answers all reach the model',
    answersSeen.length === 4 &&
      answersSeen[0]?.includes('answer=true') === true &&
      answersSeen[1]?.includes('answer="B"') === true &&
      answersSeen[2]?.includes('answer=null') === true &&
      answersSeen[3]?.includes('answer="typed text"') === true,
    answersSeen.map((text) => text.slice(0, 96)).join(' | '),
  );
  checker.check(
    'A2: model-visible result carries the host interactionId and hasUI',
    answersSeen.every(
      (text) => /interactionId=q-\d/.test(text) && text.includes('hasUI=true'),
    ) && adapter.requests.map((request) => request.interactionId).join(',') === 'q-1,q-2,q-3,q-4',
    `interactionIds=[${adapter.requests.map((request) => request.interactionId).join(',')}]`,
  );
  checker.check(
    'C: the session is occupied while the tool runs',
    answersSeen.length === 4 && answersSeen.every((text) => text.includes('idleAtToolEntry=false')),
    `idleFlags=${answersSeen.map((text) => text.match(/idleAtToolEntry=\w+/)?.[0] ?? 'none').join(',')}`,
  );
  checker.check(
    'C2: the session is still occupied while the host answer is pending',
    idleDuringWait === false,
    `pendingRequests=${adapter.requests.length} sessionIdleDuringWait=${String(idleDuringWait)}`,
  );
  checker.check(
    'F: the wrapped ctx.ui keeps notify, fails TUI-only calls with our message, and has no theme',
    answersSeen.length === 4 &&
      answersSeen.every((text) => text.includes('notify=ok')) &&
      answersSeen.every((text) =>
        text.includes('tuiError=getAllThemes(): the browser host has no Pi TUI surface'),
      ) &&
      answersSeen.every((text) => text.includes('themeAbsent=true')) &&
      adapter.notifications.length === 4,
    `notifications=${adapter.notifications.length} first=${JSON.stringify(answersSeen[0]?.slice(0, 150))}`,
  );
  checker.check(
    'stub saw one request per prompt (no extra model call for the interaction)',
    server.requests.length === 8,
    `modelRequests=${server.requests.length}`,
  );
  session.dispose();
} finally {
  await server.close();
  await env.cleanup();
}

// --- D: what actually gates interaction availability ---------------------------------------
const serverPrint = await startStubModelServer([
  questionCall({ method: 'confirm', title: '继续吗？', message: '内容' }),
  { kind: 'text', text: 'answered-without-host-ui' },
  questionCall({ method: 'confirm', title: '继续吗？', message: '内容' }),
  { kind: 'text', text: 'answered-in-print-mode' },
]);
const envPrint = await createStubEnv(serverPrint.baseUrl);
const adapterUnused = createHostUi([{ kind: 'confirm', value: true }]);
const observationsNoUi: ToolObservation[] = [];
const observationsPrint: ToolObservation[] = [];

try {
  // D1: the host never binds a UI adapter → no interaction is possible.
  const noUi = await openSession(envPrint, {
    tools: ['question'],
    extensionFactories: [
      (pi) => pi.registerTool(createQuestionTool(() => adapterUnused.lastInteractionId())),
    ],
  });
  noUi.session.subscribe((event) => collectToolResults(observationsNoUi)(event));
  await noUi.session.prompt('ask without any host UI');
  checker.check(
    'D1: without a bound UI adapter the tool gets no UI and reports it',
    observationsNoUi.length === 1 &&
      observationsNoUi[0]?.isError === true &&
      observationsNoUi[0]?.text.includes('UI not available') === true &&
      adapterUnused.requests.length === 0,
    `resultText=${JSON.stringify(observationsNoUi[0]?.text.slice(0, 120))} hostRequests=${adapterUnused.requests.length}`,
  );
  noUi.session.dispose();

  // D2: an interactive host still works when it declares mode "print" → the real gate is binding
  // the adapter, not the mode string (v1.0.0 behaviour, recorded as a fact for the contract).
  const adapterPrintMode = createHostUi([{ kind: 'confirm', value: true }]);
  const printMode = await openSession(envPrint, {
    tools: ['question'],
    extensionFactories: [
      (pi) => pi.registerTool(createQuestionTool(() => adapterPrintMode.lastInteractionId())),
    ],
  });
  printMode.session.subscribe((event) => collectToolResults(observationsPrint)(event));
  await printMode.session.bindExtensions({ uiContext: adapterPrintMode, mode: 'print' });
  await printMode.session.prompt('ask with a bound adapter in print mode');
  checker.check(
    'D2: interaction works whenever a UI adapter is bound, even declared mode "print"',
    observationsPrint.length === 1 &&
      observationsPrint[0]?.isError !== true &&
      observationsPrint[0]?.text.includes('hasUI=true') === true &&
      observationsPrint[0]?.text.includes('answer=true') === true &&
      adapterPrintMode.requests.length === 1,
    `resultText=${JSON.stringify(observationsPrint[0]?.text.slice(0, 120))} hostRequests=${adapterPrintMode.requests.length}`,
  );
  printMode.session.dispose();
} finally {
  await serverPrint.close();
  await envPrint.cleanup();
}

checker.finish();