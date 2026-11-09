/**
 * Real-model backlog check (needs kaiming/config/model.json): does a real chief use the `backlog`
 * and `project` tools — not bash — to set up the records, add items, and repair a duplicate id?
 *
 * It is a behavioural probe, not a unit test: the point is prompt adherence that only a real model
 * can show. Transcripts are counted so the answer is "what the model did", not "what the file says".
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
  console.error(`backlog real-model check cannot start: ${loaded.error}`);
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

const agentEnv = await createStubEnv(undefined, { providers: config.providers });
const workspace = mkdtempSync(join(tmpdir(), 'kaiming-backlog-real-'));
const store = new Store({ path: join(workspace, 'state.db'), serverEpoch: 1 });
const promptDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'technicalnew', 'prompts');

let inputSeq = 0;
function acceptChiefInput(text: string): string {
  inputSeq += 1;
  const inputId = `i-${inputSeq}`;
  store.acceptInput({
    inputId,
    projectId: 'p-1',
    sessionId: 's-chief',
    sourceKey: `user:${inputId}`,
    requestKey: inputId,
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text }] },
  });
  return inputId;
}

/** Tool results recorded in the chief's Pi transcript. */
function toolResults(): Array<{ tool: string; error: boolean; text: string }> {
  const out: Array<{ tool: string; error: boolean; text: string }> = [];
  const binding = store.getSessionBinding('s-chief');
  if (binding === undefined) return out;
  let text: string;
  try {
    text = readFileSync(binding.piFile, 'utf8');
  } catch {
    return out;
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
    const content = Array.isArray(entry.message.content)
      ? entry.message.content
          .map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : ''))
          .join(' ')
      : '';
    out.push({ tool: entry.message.toolName ?? 'unknown', error: entry.message.isError === true, text: content });
  }
  return out;
}

try {
  const projectDir = join(workspace, 'project');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'README.md'), '# Small service\n\nThe whole module in one place.\n', 'utf8');
  store.createProject({ id: 'p-1', realPath: projectDir });
  store.createSession({ id: 's-chief', projectId: 'p-1', roleId: 'chief', cwd: projectDir });

  acceptChiefInput(
    [
      'Set up this project records and its first backlog items, using only the project and backlog tools.',
      '',
      '1. Call project(op=initialize) and record one module: `core` — the whole service lives in README.md.',
      '2. Add two backlog items with backlog(op=add): "登录页按钮文案" and "会话列表分页".',
      '3. Then call backlog(op=list) and report the ids you created.',
      '',
      'Do not edit files with bash or any editor; the backlog tool is how items are written.',
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

  const keepAlive = setInterval(() => undefined, 1_000);
  // The chief may ask the user to confirm a write. There is no browser here, so the check plays
  // the user: confirm = yes, select = the first option, input = a plain go-ahead.
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
          runner.interactions.resolve(interaction.interactionId, response);
          console.log(
            `answered ${interaction.method} from ${session.id}: ${JSON.stringify(interaction.message ?? interaction.title).slice(0, 160)}`,
          );
        } catch (error) {
          console.log(`could not answer ${interaction.interactionId}: ${String(error)}`);
        }
      }
    }
  }, 500);
  try {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const outcome = await runner.runNext('s-chief');
      console.log(`chief input ${attempt}: ${outcome.kind === 'completed' ? `completed:${outcome.detail ?? ''}` : outcome.kind}`);
      if (outcome.kind !== 'completed') break;
      const stats = toolResults();
      if (stats.some((entry) => entry.tool === 'backlog' && !entry.error) && stats.some((entry) => entry.tool === 'project' && !entry.error)) {
        break;
      }
      acceptChiefInput('Continue with the steps above; use project(op=initialize) and backlog(op=add) as instructed.');
    }
  } finally {
    clearInterval(keepAlive);
    clearInterval(answerPending);
  }

  const entries = toolResults();
  const byTool = (name: string): number => entries.filter((entry) => entry.tool === name).length;
  const ok = (name: string): boolean => entries.some((entry) => entry.tool === name && !entry.error);
  const backlogFile = join(projectDir, '.dev', 'backlog.md');
  const backlogText = ((): string => {
    try {
      return readFileSync(backlogFile, 'utf8');
    } catch {
      return '';
    }
  })();
  const readOr = (path: string): string => {
    try {
      return readFileSync(join(projectDir, path), 'utf8');
    } catch {
      return '';
    }
  };
  const agentsText = readOr('AGENTS.md');
  const projectText = readOr('.dev/PROJECT.md');

  check(
    'the real chief initialized the records with the project tool',
    ok('project') && agentsText.length > 0,
    `projectCalls=${String(byTool('project'))} agentsBytes=${String(agentsText.length)}`,
  );
  check(
    'the generated records name the module map',
    /^#{2,3}\s+(模块|modules)\s*$/im.test(projectText) || /^#{2,3}\s+(模块|modules)\s*$/im.test(agentsText),
    `project=${JSON.stringify(projectText.slice(0, 240))} agents=${JSON.stringify(agentsText.slice(0, 240))}`,
  );
  check(
    'the two items were written through the backlog tool, not bash',
    ok('backlog') && /登录页按钮文案/.test(backlogText) && /会话列表分页/.test(backlogText),
    `backlogCalls=${String(byTool('backlog'))} file=${JSON.stringify(backlogText.slice(0, 240))}`,
  );

  // A duplicate id is the case the tool's `edit` exists for: the model must repair it in place.
  const entriesBeforeRepair = toolResults().length;
  const idsBeforeRepair = new Set(
    [...backlogText.matchAll(/^###\s+([A-Za-z]+-\d+)\s/mg)].map((match) => match[1] ?? ''),
  );
  writeFileSync(
    backlogFile,
    `${backlogText.replace(/\s*$/, '')}\n\n### B-1 重复的编号\n- 状态: open\n`,
    'utf8',
  );
  acceptChiefInput(
    [
      'I hand-edited .dev/backlog.md and introduced a duplicate id: two items are numbered B-1.',
      'Repair it with backlog(op=edit): give the newer duplicate a free id and nothing else. Do not rewrite the file with bash.',
    ].join('\n'),
  );
  const outcome = await runner.runNext('s-chief');
  console.log(`duplicate repair: ${outcome.kind === 'completed' ? `completed:${outcome.detail ?? ''}` : outcome.kind}`);
  const repaired = readFileSync(backlogFile, 'utf8');
  const ids = [...repaired.matchAll(/^###\s+([A-Za-z]+-\d+)\s/mg)].map((match) => match[1]);
  const repairCalls = toolResults().slice(entriesBeforeRepair);
  const newIds = ids.filter((id) => id !== undefined && !idsBeforeRepair.has(id));
  const editUsed = repairCalls.some(
    (entry) =>
      entry.tool === 'backlog' &&
      !entry.error &&
      (newIds.some((id) => id !== undefined && entry.text.includes(id)) || /edit/i.test(entry.text)),
  );
  check(
    'the real model repaired the duplicate through backlog(op=edit)',
    new Set(ids).size === ids.length && ids.length >= 3 && editUsed,
    `ids=${JSON.stringify(ids)} editUsed=${String(editUsed)} file=${JSON.stringify(repaired.slice(0, 320))}`,
  );
} finally {
  store.close();
  await agentEnv.cleanup();
  rmSync(workspace, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} backlog real-model checks passed`);
if (failed.length > 0) {
  process.exitCode = 1;
}
