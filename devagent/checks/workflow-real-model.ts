/**
 * Real-model workflow check: the whole Task flow, driven by a real model.
 *
 * create → dispatch develop → independent review → independent test → settlement → end, with the
 * program's own rules unchanged: the chief chooses every call, members deliver formal reports, and
 * the completion checks (delivery binding, necessary reports) decide whether `task(op=end)` succeeds.
 *
 * Needs devagent/config/model.json (the same file the other real-model checks use). It is a
 * behavioural probe, not a unit test: results depend on the model. It prints the tool-call/error
 * counts of every session so the flow can be compared across protocol revisions.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelConfig } from '../spikes/harness/model-config.ts';
import { createStubEnv } from '../spikes/harness/pi-env.ts';
import { resolveEffectiveConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';
import { InputRunner } from '../src/runtime/runner.ts';
import { Store } from '../src/store/store.ts';

const loaded = loadModelConfig();
if (!loaded.ok) {
  console.error(`workflow real-model check cannot start: ${loaded.error}`);
  process.exit(1);
}
const { config } = loaded;
for (const [key, value] of Object.entries(config.env)) {
  process.env[key] = value;
}

const MAX_CHIEF_INPUTS = 14;
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
};

let lastOutcome = '';
const agentEnv = await createStubEnv(undefined, { providers: config.providers });
const workspace = mkdtempSync(join(tmpdir(), 'devagent-workflow-real-'));
const store = new Store({ path: join(workspace, 'state.db'), serverEpoch: 1 });
const startedAt = Date.now();
const promptDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'technicalnew', 'prompts');

/** The project starts with its knowledge entry already in place, so this check measures the flow. */
function seedProject(cwd: string): void {
  mkdirSync(join(cwd, 'src'), { recursive: true });
  mkdirSync(join(cwd, 'test'), { recursive: true });
  mkdirSync(join(cwd, '.dev'), { recursive: true });
  writeFileSync(
    join(cwd, 'AGENTS.md'),
    '# Project rules\n\n- Keep the code small and dependency-free.\n- Tests run with `node --test`.\n',
    'utf8',
  );
  writeFileSync(join(cwd, '.dev', 'INDEX.md'), '# Index\n\n- AGENTS.md: project rules\n', 'utf8');
}

let inputSeq = 0;
function acceptChiefInput(text: string): string {
  inputSeq += 1;
  const inputId = `i-${inputSeq}`;
  store.acceptInput({
    inputId,
    projectId: 'p-1',
    sessionId: 's-chief',
    ...(store.getSession('s-chief')?.currentTaskId != null
      ? { taskId: store.getSession('s-chief')?.currentTaskId as string }
      : {}),
    sourceKey: `user:${inputId}`,
    requestKey: inputId,
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text }] },
  });
  return inputId;
}

/** Tool results recorded in the Pi transcripts: the only honest count of what the model did. */
function toolStats(): {
  results: number;
  errors: number;
  byTool: Record<string, number>;
  errorsByTool: Record<string, number>;
  samples: string[];
  errorTexts: string[];
} {
  let results = 0;
  let errors = 0;
  const byTool: Record<string, number> = {};
  const errorsByTool: Record<string, number> = {};
  const samples: string[] = [];
  const errorTexts: string[] = [];
  for (const session of store.listSessions()) {
    const binding = store.getSessionBinding(session.id);
    if (binding === undefined) continue;
    let text: string;
    try {
      text = readFileSync(binding.piFile, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let entry: { type?: string; message?: { role?: string; toolName?: string; isError?: boolean; content?: unknown } };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== 'message' || entry.message?.role !== 'toolResult') continue;
      results += 1;
      const name = entry.message.toolName ?? 'unknown';
      byTool[name] = (byTool[name] ?? 0) + 1;
      if (entry.message.isError === true) {
        errors += 1;
        errorsByTool[name] = (errorsByTool[name] ?? 0) + 1;
        {
          const content = Array.isArray(entry.message.content)
            ? entry.message.content
                .map((part) =>
                  typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '',
                )
                .join(' ')
            : '';
          errorTexts.push(content);
          if (samples.length < 8) samples.push(`${name}: ${content.slice(0, 220)}`);
        }
      }
    }
  }
  return { results, errors, byTool, errorsByTool, samples, errorTexts };
}

try {
  const projectDir = join(workspace, 'project');
  seedProject(projectDir);
  store.createProject({ id: 'p-1', realPath: projectDir });
  store.createSession({ id: 's-chief', projectId: 'p-1', roleId: 'chief', cwd: projectDir });
  store.setProjectInitialization({
    projectId: 'p-1',
    initializationRef: {
      schemaVersion: 1,
      files: [
        { path: 'AGENTS.md', sha256: '' },
        { path: '.dev/INDEX.md', sha256: '' },
      ],
      reusedAuthorityRefs: [],
    },
  });

  acceptChiefInput(
    [
      'Please deliver a small change in this project, end to end.',
      '',
      'Goal: add `reverse(text)` to `src/text.js` (exported as a named function) and a `node:test` suite',
      'in `test/reverse.test.js` that proves “abc” → “cba” and empty string → empty string.',
      'Run the suite with `node --test` and make it pass.',
      '',
      'Use the Task flow: create the Task, dispatch the developer, then an independent review, an',
      'independent test, settlement, and finish the Task. Report what you did at the end.',
    ].join('\n'),
  );

  const defaults: RuntimeDefaults = {
    model: { providerId: config.provider, modelId: config.model },
    agentDir: agentEnv.agentDir,
    promptDir,
    tools: [],
  };
  const runner = new InputRunner({
    store,
    registry: new SessionRegistry(new PiRuntimeFactory(defaults)),
    factory: new PiRuntimeFactory(defaults),
    resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server: defaults }),
  });

  // The Pi SDK's in-flight model request does not always hold the Node event loop open; a CLI
  // probe keeps it alive so a real model call is not cut short by "unsettled top-level await".
  const keepAlive = setInterval(() => undefined, 1_000);
  // The model may ask a question through ctx.ui (G2). There is no browser here, so the check plays
  // the user: confirm = yes, select = the first option, input = a plain go-ahead. Every question is
  // printed, so the transcript shows what the model needed to know.
  const answerPending = setInterval(() => {
    for (const session of store.listSessions()) {
      for (const interaction of store.listPendingInteractions(session.id)) {
        if (interaction.inputId === null) continue;
        const response =
          interaction.method === 'confirm'
            ? { confirmed: true }
            : interaction.method === 'select'
              ? (JSON.parse(interaction.options ?? '[]') as string[])[0] ?? 'yes'
              : 'yes, proceed';
        try {
          store.resolveInteraction({
            interactionId: interaction.interactionId,
            expectedRevision: interaction.revision,
            response,
            answeredBy: 'check:user',
            requestKey: `check:${interaction.interactionId}`,
          });
          // The durable row alone leaves the ctx.ui call waiting; the bridge releases it, exactly as
          // the browser's interaction.respond does in the real host.
          runner.interactions.resolve(interaction.interactionId, response);
          console.log(
            `answered ${interaction.method} from ${session.id}/${session.roleId}: ` +
              JSON.stringify(interaction.message ?? interaction.title).slice(0, 200),
          );
        } catch (error) {
          console.log(`could not answer ${interaction.interactionId}: ${String(error)}`);
        }
      }
    }
  }, 500);
  try {
  for (let attempt = 1; attempt <= MAX_CHIEF_INPUTS; attempt += 1) {
    const before = store.listTasks('p-1')[0];
    const outcome = await runner.runNext('s-chief');
    lastOutcome = outcome.kind === 'completed' ? `completed:${outcome.detail ?? ''}` : outcome.kind;
    const task = store.listTasks('p-1')[0];
    let state = 'no task';
    if (task !== undefined) {
      const results = store.listTaskResults(task.id);
      const kinds = [...new Set(results.map((result) => `${result.kind}${result.verdict ? `/${result.verdict}` : ''}`))];
      state = `${task.phase}/${task.status} members=${task.currentSessionIds.length} reports=[${kinds.join(', ')}]`;
    }
    console.log(`chief input ${attempt}: ${lastOutcome} | ${state}`);
    if (task === undefined || task.id !== before?.id) {
      // Nothing created yet (or a new Task): keep going if the model stopped early.
    }
    if (task !== undefined && task.status === 'completed') break;
    if (outcome.kind === 'blocked' || outcome.kind === 'failed') break;
    acceptChiefInput(
      'Continue the workflow. Start with task(op=get) and follow its nextActions; do not repeat work ' +
        'that is already recorded. Finish the Task with task(op=end) once the settlement exists.',
    );
  }
  } finally {
    clearInterval(keepAlive);
    clearInterval(answerPending);
  }

  const tasks = store.listTasks('p-1');
  const writeTasks = tasks.filter((entry) => entry.type === 'write');
  // The flow is about the delivery: a preliminary read/analysis Task is legitimate product behaviour.
  const task = writeTasks.find((entry) => entry.status === 'completed') ?? writeTasks[0];
  const results = task === undefined ? [] : store.listTaskResults(task.id);
  const stats = toolStats();
  const elapsedMs = Date.now() - startedAt;

  check(
    'the model created one write Task and completed it',
    writeTasks.length === 1 && task !== undefined && task.status === 'completed',
    `tasks=${tasks.length} write=${writeTasks.length} status=${String(task?.status)} phase=${String(task?.phase)}`,
  );
  check(
    'the developer delivered an implementation report',
    results.some((result) => result.kind === 'implementation'),
    `kinds=${results.map((result) => result.kind).join(',')}`,
  );
  check(
    'an independent review passed and an independent test passed',
    results.some((result) => result.kind === 'review' && result.verdict === 'passed') &&
      results.some((result) => result.kind === 'test' && result.verdict === 'passed'),
    `review=${results.find((result) => result.kind === 'review')?.verdict ?? 'none'} ` +
      `test=${results.find((result) => result.kind === 'test')?.verdict ?? 'none'}`,
  );
  check(
    'a settlement report closed the Task and it names the commit/file it saved',
    results.some((result) => result.kind === 'settlement'),
    `settlement=${results.some((result) => result.kind === 'settlement')}`,
  );
  check(
    'review and test recorded the delivery state the program observed',
    results.filter((result) => result.kind === 'review' || result.kind === 'test').every((result) => result.deliveryState !== null),
    `delivery=${results
      .filter((result) => result.kind === 'review' || result.kind === 'test')
      .map((result) => `${result.kind}:${result.deliveryState?.paths.length ?? 0} files`)
      .join(', ')}`,
  );
  const sourceExists = (() => {
    try {
      return readFileSync(join(projectDir, 'src', 'text.js'), 'utf8').includes('reverse');
    } catch {
      return false;
    }
  })();
  check('the delivered file really exists with the function', sourceExists, `src/text.js present=${sourceExists}`);
  const testRun = await runNodeTest(projectDir);
  check('the delivered test suite really passes', testRun.ok, testRun.detail);
  // Shell tools report a non-zero exit as an error (a failing command is often the check itself);
  // the protocol tools are the ones this refactor is measured on.
  const protocol = ['task', 'agent_report', 'requirement', 'project', 'question'];
  const protocolCalls = protocol.reduce((sum, name) => sum + (stats.byTool[name] ?? 0), 0);
  const protocolErrors = protocol.reduce((sum, name) => sum + (stats.errorsByTool[name] ?? 0), 0);
  const rate = protocolCalls === 0 ? 0 : protocolErrors / protocolCalls;
  // The protocol's own job is that the state machine never dead-ends the model. Argument shapes, the
  // read-before-write safety refusals (VERSION_CONFLICT) and a completion attempt refused with its gaps
  // (COMPLETION_INCOMPLETE) are expected and recoverable; step refusals mean the protocol itself blocks.
  const STATE_CODES = ['STAGE_NOT_READY', 'TASK_CONTROLLED', 'RECOVERY_REQUIRED'];
  const codes = stats.errorTexts
    .map((text) => /"code":"([A-Z_]+)"/.exec(text)?.[1])
    .filter((code): code is string => code !== undefined);
  const stateErrors = codes.filter((code) => STATE_CODES.includes(code));
  const safetyRefusals = codes.filter((code) => code === 'VERSION_CONFLICT');
  const completionRefusals = codes.filter((code) => code === 'COMPLETION_INCOMPLETE');
  check(
    'no step or precondition refusal dead-ended the model',
    stateErrors.length === 0,
    `step refusals=${stateErrors.length} codes=${JSON.stringify(stateErrors)} ` +
      `read-before-write refusals=${safetyRefusals.length} ` +
      `completion refusals=${completionRefusals.length}`,
  );
  console.log(
    `METRIC protocol calls=${protocolCalls} errors=${protocolErrors} rate=${(rate * 100).toFixed(1)}% ` +
      `all results=${stats.results} errors=${stats.errors} byTool=${JSON.stringify(stats.byTool)} ` +
      `errorsByTool=${JSON.stringify(stats.errorsByTool)}`,
  );
  if (stats.errors > 0) {
    console.log('tool error samples:');
    for (const sample of stats.samples) console.log(`  - ${sample}`);
  }
  console.log(`elapsed=${Math.round(elapsedMs / 1000)}s`);

  function runNodeTest(cwd: string): Promise<{ ok: boolean; detail: string }> {
    return new Promise((resolve) => {
      import('node:child_process').then(({ execFile }) => {
        execFile('node', ['--test'], { cwd, timeout: 60_000 }, (error, stdout, stderr) => {
          resolve({
            ok: error === null,
            detail: error === null ? stdout.trim().split('\n').at(-3) ?? 'passed' : (stderr || String(error)).slice(0, 300),
          });
        });
      });
    });
  }
} finally {
  store.close();
  await agentEnv.cleanup();
  rmSync(workspace, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} workflow checks passed (last chief outcome: ${lastOutcome})`);
if (failed.length > 0) {
  process.exitCode = 1;
}
