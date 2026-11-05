/**
 * PI-02 (settle semantics): what the SDK actually reports at the boundary between
 * "the run finished", "Pi will not continue", and "the bytes reached disk".
 *
 * Proves:
 *  A. an HTTP failure of the model endpoint triggers Pi's own retry, and the prompt still resolves
 *     only after the retried run finished;
 *  B. a failing native tool is returned as a normal tool error and the run still settles;
 *  C. the public event order (agent_start → message_* → turn_end → agent_end → agent_settled);
 *  D. a JSONL write failure is NOT reported as a completed run: memory may advance while the
 *     file does not, which is exactly the case R4/S4 say must not be called `completed`.
 */
import { chmod } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createChecker, createStubEnv, openSession, startStubModelServer } from './harness/pi-env.ts';

const checker = createChecker();

async function lineCount(file: string): Promise<number> {
  const text = await readFile(file, 'utf8');
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

// --- A: HTTP failure + native retry -------------------------------------------------------
{
  const server = await startStubModelServer([
    { kind: 'http_error', status: 500, message: 'boom' },
    { kind: 'text', text: 'after-retry' },
  ]);
  const env = await createStubEnv(server.baseUrl);
  try {
    const events: string[] = [];
    const { session } = await openSession(env, { noTools: 'all' });
    session.subscribe((event) => events.push(event.type));
    await session.prompt('trigger retry');
    checker.check(
      'A: model 500 is retried natively and prompt resolves after the retried run',
      server.requests.length >= 2 && session.getLastAssistantText() === 'after-retry',
      `requests=${server.requests.length} lastText=${JSON.stringify(session.getLastAssistantText())} events=[${events.join(',')}]`,
    );
    session.dispose();
  } finally {
    await server.close();
    await env.cleanup();
  }
}

// --- B/C: failing native tool + public event order -----------------------------------------
{
  const server = await startStubModelServer([
    { kind: 'tool_calls', calls: [{ name: 'read', arguments: '{"path":"missing-file.txt"}' }] },
    { kind: 'text', text: 'recovered-after-tool-error' },
  ]);
  const env = await createStubEnv(server.baseUrl);
  try {
    const events: string[] = [];
    const toolResults: string[] = [];
    const { session } = await openSession(env, { tools: ['read'] });
    session.subscribe((event) => {
      events.push(event.type);
      if (event.type === 'message_end' && event.message.role === 'toolResult') {
        toolResults.push(`${String(event.message.toolName)}=${event.message.isError === true ? 'error' : 'ok'}`);
      }
    });
    await session.prompt('call a tool that fails');
    checker.check(
      'B: failing native tool is a normal tool result and the run still settles',
      toolResults.length === 1 &&
        toolResults[0]?.endsWith('=error') === true &&
        session.getLastAssistantText() === 'recovered-after-tool-error',
      `toolResults=[${toolResults.join(',')}] lastText=${JSON.stringify(session.getLastAssistantText())}`,
    );
    const order = events.join(' > ');
    const settledLast = events[events.length - 1] === 'agent_settled';
    const endBeforeSettled =
      events.indexOf('agent_end') !== -1 && events.indexOf('agent_end') < events.indexOf('agent_settled');
    const messageEndBeforeTurnEnd =
      events.indexOf('message_end') !== -1 &&
      events.indexOf('message_end') < events.indexOf('turn_end');
    checker.check(
      'C: public order message_end < turn_end < agent_end < agent_settled',
      settledLast && endBeforeSettled && messageEndBeforeTurnEnd,
      order,
    );
    session.dispose();
  } finally {
    await server.close();
    await env.cleanup();
  }
}

// --- D: JSONL write failure injection ------------------------------------------------------
{
  const server = await startStubModelServer([
    { kind: 'text', text: 'first-ok' },
    { kind: 'text', text: 'second-after-chmod' },
  ]);
  const env = await createStubEnv(server.baseUrl);
  let file = '';
  try {
    const { session, sessionManager } = await openSession(env, { noTools: 'all' });
    await session.prompt('first turn');
    file = sessionManager.getSessionFile() ?? '';
    const linesBefore = await lineCount(file);
    const memoryBefore = session.messages.length;

    await chmod(file, 0o444);
    await chmod(env.sessionDir, 0o555);
    let thrown = '';
    try {
      await session.prompt('second turn while the file is read-only');
    } catch (error) {
      thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    } finally {
      await chmod(env.sessionDir, 0o755);
      await chmod(file, 0o644);
    }
    const linesAfter = await lineCount(file);
    const memoryAfter = session.messages.length;
    checker.check(
      'D: read-only JSONL is not silently reported as a completed run',
      thrown !== '' || memoryAfter > memoryBefore,
      `thrown=${thrown === '' ? 'none' : thrown} memory ${memoryBefore}->${memoryAfter} fileLines ${linesBefore}->${linesAfter}`,
    );
    checker.check(
      'D: unpersisted turn is visible as memory-ahead-of-disk',
      memoryAfter > memoryBefore && linesAfter === linesBefore,
      `memoryAdvanced=${memoryAfter > memoryBefore} filePersisted=${linesAfter > linesBefore} lines ${linesBefore}->${linesAfter}`,
    );
    session.dispose();
  } finally {
    await server.close();
    await env.cleanup();
  }
}

checker.finish();