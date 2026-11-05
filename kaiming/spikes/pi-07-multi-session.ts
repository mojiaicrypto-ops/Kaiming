/**
 * PI-07 (multi-session isolation): two sessions with different cwd, model, tool set and project
 * rules must run concurrently without sharing state; an unavailable model must fail loudly instead
 * of silently falling back; and process-global cwd/env must stay untouched (A5).
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
  createChecker,
  createStubEnv,
  openSession,
  requestedModelId,
  startStubModelServer,
} from './harness/pi-env.ts';

const checker = createChecker();
const processCwdBefore = process.cwd();
const envBefore = JSON.stringify(Object.entries(process.env).sort());

const serverA = await startStubModelServer([
  { kind: 'tool_calls', calls: [{ name: 'read', arguments: '{"path":"a.txt"}' }] },
  { kind: 'text', text: 'A-done' },
]);
const serverB = await startStubModelServer([
  { kind: 'tool_calls', calls: [{ name: 'read', arguments: '{"path":"a.txt"}' }] },
  { kind: 'text', text: 'B-done' },
]);

const envA = await createStubEnv(serverA.baseUrl, {
  modelIds: ['stub-1', 'stub-2'],
  deadProviderBaseUrl: 'http://127.0.0.1:1/v1',
});
const envB = await createStubEnv(serverB.baseUrl);

await writeFile(join(envA.cwd, 'AGENTS.md'), 'PROJECT-A-RULE\n');
await writeFile(join(envB.cwd, 'AGENTS.md'), 'PROJECT-B-RULE\n');
await writeFile(join(envA.cwd, 'a.txt'), 'alpha\n');

interface ToolObservation {
  readonly isError: boolean;
  readonly text: string;
}

const observationsA: ToolObservation[] = [];
const observationsB: ToolObservation[] = [];

const collect =
  (target: ToolObservation[]) =>
  (event: AgentSessionEvent): void => {
    if (event.type === 'message_end' && event.message.role === 'toolResult') {
      target.push({
        isError: event.message.isError === true,
        text: event.message.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
      });
    }
  };

try {
  const a = await openSession(envA, { modelId: 'stub-2', tools: ['read'] });
  const b = await openSession(envB, { modelId: 'stub-1', tools: ['read', 'ls'] });
  a.session.subscribe(collect(observationsA));
  b.session.subscribe(collect(observationsB));

  await Promise.all([a.session.prompt('read a.txt'), b.session.prompt('read a.txt')]);

  const requestModel = (server: typeof serverA): string => requestedModelId(server.requests[0]);

  checker.check(
    'concurrent sessions use their own model (no global model switch)',
    requestModel(serverA) === 'stub-2' && requestModel(serverB) === 'stub-1',
    `A=${requestModel(serverA)} B=${requestModel(serverB)}`,
  );
  checker.check(
    'each session keeps its own cwd and session file',
    a.sessionManager.getCwd() === envA.cwd &&
      b.sessionManager.getCwd() === envB.cwd &&
      (a.sessionManager.getSessionFile() ?? '').startsWith(envA.sessionDir) &&
      (b.sessionManager.getSessionFile() ?? '').startsWith(envB.sessionDir),
    `A cwd=${a.sessionManager.getCwd()} file=${String(a.sessionManager.getSessionFile())} | B cwd=${b.sessionManager.getCwd()} file=${String(b.sessionManager.getSessionFile())}`,
  );
  checker.check(
    'native tool executes inside its own project (A reads, B fails on the same relative path)',
    observationsA[0]?.isError === false &&
      observationsA[0]?.text.includes('alpha') &&
      observationsB[0]?.isError === true,
    `A=${JSON.stringify(observationsA[0]?.text.slice(0, 40))} isError=${String(observationsA[0]?.isError)} | B isError=${String(observationsB[0]?.isError)}`,
  );
  checker.check(
    'project rules are assembled per session (no shared global prompt)',
    a.session.systemPrompt.includes('PROJECT-A-RULE') &&
      b.session.systemPrompt.includes('PROJECT-B-RULE') &&
      !a.session.systemPrompt.includes('PROJECT-B-RULE'),
    `A has own=${a.session.systemPrompt.includes('PROJECT-A-RULE')} | B has own=${b.session.systemPrompt.includes('PROJECT-B-RULE')} | A leaked B=${a.session.systemPrompt.includes('PROJECT-B-RULE')}`,
  );
  checker.check(
    'tool set is per session',
    a.session.getActiveToolNames().join(',') === 'read' &&
      b.session.getActiveToolNames().includes('ls'),
    `A=[${a.session.getActiveToolNames().join(',')}] B=[${b.session.getActiveToolNames().join(',')}]`,
  );
  checker.check(
    'process-global cwd unchanged by any session',
    process.cwd() === processCwdBefore,
    `cwd=${process.cwd()}`,
  );
  checker.check(
    'process.env unchanged by any session (no global env switching)',
    JSON.stringify(Object.entries(process.env).sort()) === envBefore,
    `envKeys=${Object.keys(process.env).length}`,
  );

  const requestsBeforeDead = serverA.requests.length;
  const missing = a.modelRuntime.getModel('stub', 'does-not-exist');
  let deadOutcome = 'resolved';
  let deadSignal = 'none';
  try {
    const dead = await openSession(envA, { providerId: 'dead', modelId: 'dead-1' });
    try {
      await dead.session.prompt('this must fail');
      const lastMessage = dead.session.messages[dead.session.messages.length - 1];
      if (lastMessage?.role === 'assistant') {
        deadSignal = `assistant stopReason=${lastMessage.stopReason} error=${String(lastMessage.errorMessage ?? 'none')} text=${JSON.stringify(dead.session.getLastAssistantText())}`;
      } else {
        deadSignal = `lastRole=${String(lastMessage?.role ?? 'none')}`;
      }
    } finally {
      dead.session.dispose();
    }
  } catch (error) {
    deadOutcome = `rejected: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
    deadSignal = 'prompt-threw';
  }
  checker.check(
    'unregistered model resolves to undefined (no invented fallback)',
    missing === undefined,
    `getModel(stub/does-not-exist)=${String(missing)}`,
  );
  checker.check(
    'unavailable endpoint is an observable failed run, not a silent success or fallback',
    deadOutcome !== 'resolved' || deadSignal.includes('stopReason=error') || deadSignal.includes('stopReason=aborted'),
    `outcome=${deadOutcome.slice(0, 80)} signal=${deadSignal.slice(0, 160)} newRequestsToWorkingStub=${serverA.requests.length - requestsBeforeDead}`,
  );

  a.session.dispose();
  b.session.dispose();
} finally {
  await serverA.close();
  await serverB.close();
  await envA.cleanup();
  await envB.cleanup();
  checker.finish();
}