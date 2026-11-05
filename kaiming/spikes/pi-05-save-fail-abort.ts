/**
 * PI-05 (host save failure + stop): a custom tool that represents "durable host write" must not
 * report success when its save fails, must initiate the stop from inside the tool (ctx.abort),
 * and the outer layer must await real idleness before recording any terminal state.
 *
 * Proves:
 *  A. the failing host write is visible as an error result (never a success claim);
 *  B. ctx.abort() from inside the tool stops the run; the model is not asked to continue;
 *  C. the outer `await session.abort()` + `waitForIdle()` reaches a confirmed idle boundary;
 *  D. no partial success artifact exists, and the persisted boundary is inspectable.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type InlineExtension } from '@earendil-works/pi-coding-agent';
import { createChecker, createStubEnv, openSession, startStubModelServer } from './harness/pi-env.ts';

const checker = createChecker();
const server = await startStubModelServer([
  { kind: 'tool_calls', calls: [{ name: 'host_save', arguments: '{"record":"r-1"}' }] },
  { kind: 'text', text: 'continued after tool' },
]);
const env = await createStubEnv(server.baseUrl);
const readOnlyDir = join(env.root, 'readonly');
await mkdir(readOnlyDir, { recursive: true });
await chmod(readOnlyDir, 0o555);
const target = join(readOnlyDir, 'receipt.json');

const toolResults: Array<{ isError: boolean; text: string }> = [];
let abortRequested = false;

const extension: InlineExtension = (pi) => {
  pi.registerTool({
    name: 'host_save',
    label: 'host_save',
    description: 'attempts a durable host write that is expected to fail',
    parameters: { type: 'object', properties: { record: { type: 'string' } } },
    executionMode: 'sequential',
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      let failure = '';
      try {
        await writeFile(target, '{}');
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      // Stop from inside the tool; the outer layer awaits real idleness (S5).
      abortRequested = true;
      ctx.abort();
      return {
        content: [
          {
            type: 'text',
            text: failure === '' ? 'SAVED' : `HOST_SAVE_FAILED ${failure}`,
          },
        ],
        isError: failure !== '',
        details: { code: failure === '' ? 'ok' : 'STORAGE_UNAVAILABLE' },
      };
    },
  });
};

try {
  const { session, sessionManager } = await openSession(env, {
    extensionFactories: [extension],
    tools: ['host_save'],
  });
  session.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'toolResult') {
      const message = event.message;
      toolResults.push({
        isError: message.isError === true,
        text: message.content
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join(''),
      });
    }
  });

  let promptOutcome = 'resolved';
  try {
    await session.prompt('persist a record');
  } catch (error) {
    promptOutcome = `rejected: ${error instanceof Error ? error.message : String(error)}`;
  }
  // Outer stop path: await the session actually becoming idle.
  await session.abort();
  await session.waitForIdle();

  const last = toolResults[toolResults.length - 1];
  const lastText = last?.text ?? '';

  checker.check(
    'A: failing host write surfaces as an error result, never a success claim',
    last !== undefined && last.isError && lastText.startsWith('HOST_SAVE_FAILED'),
    `isError=${String(last?.isError)} text=${JSON.stringify(lastText.slice(0, 80))}`,
  );
  checker.check(
    'B: ctx.abort() from inside the tool stops the run; no model continuation follows',
    abortRequested && server.requests.length === 1,
    `abortRequested=${abortRequested} modelRequests=${server.requests.length} prompt=${promptOutcome}`,
  );
  checker.check(
    'C: outer abort + waitForIdle reaches a confirmed idle boundary',
    session.isIdle === true,
    `isIdle=${session.isIdle} prompt=${promptOutcome}`,
  );
  checker.check(
    'D: no partial success artifact exists at the target path',
    !existsSync(target),
    `target=${target} exists=${existsSync(target)}`,
  );
  const file = sessionManager.getSessionFile();
  const entryTypes = sessionManager.getEntries().map((entry) => entry.type).join(',');
  console.log(`\npersisted boundary: file=${String(file)} entries=[${entryTypes}]`);

  const persistedEntries: Array<Record<string, unknown>> =
    file === undefined
      ? []
      : (await readFile(file, 'utf8'))
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => JSON.parse(line) as Record<string, unknown>);
  const persistedFailedToolResult = persistedEntries.some((entry) => {
    const message = entry['message'];
    if (
      entry['type'] !== 'message' ||
      typeof message !== 'object' ||
      message === null ||
      !('role' in message)
    ) {
      return false;
    }
    return message.role === 'toolResult' && 'isError' in message && message.isError === true;
  });
  checker.check(
    'E: the failed tool result is persisted on disk with isError=true',
    persistedFailedToolResult,
    `lines=${persistedEntries.length} persistedFailedToolResult=${persistedFailedToolResult}`,
  );
  session.dispose();
} finally {
  await chmod(readOnlyDir, 0o755);
  await server.close();
  await env.cleanup();
  checker.finish();
}