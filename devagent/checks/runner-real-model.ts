/**
 * Real-model end-to-end check for the P2 runner (needs devagent/config/model.json).
 *
 * Runs the full path against a real provider: accept an input → claim → deliver to its own Pi
 * session → settle → classify → record the delivered boundary. Proves the runner works with a real
 * model, not only with the scripted stub endpoint.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadModelConfig } from '../spikes/harness/model-config.ts';
import { createStubEnv } from '../spikes/harness/pi-env.ts';
import { resolveEffectiveConfig, type RuntimeDefaults } from '../src/runtime/config.ts';
import { PiRuntimeFactory } from '../src/runtime/pi-runtime.ts';
import { SessionRegistry } from '../src/runtime/registry.ts';
import { InputRunner } from '../src/runtime/runner.ts';
import { Store } from '../src/store/store.ts';

const loaded = loadModelConfig();
if (!loaded.ok) {
  console.error(`runner real-model check cannot start: ${loaded.error}`);
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

// Temporary agent dir (models.json/auth.json) and a throwaway project workspace.
const agentEnv = await createStubEnv(undefined, { providers: config.providers });
const workspace = mkdtempSync(join(tmpdir(), 'devagent-runner-real-'));
const store = new Store({ path: join(workspace, 'state.db'), serverEpoch: 1 });
const startedAt = Date.now();

try {
  store.createProject({ id: 'p-1', realPath: workspace });
  store.createSession({ id: 's-1', projectId: 'p-1', roleId: 'chief', cwd: workspace });
  store.acceptInput({
    inputId: 'i-1',
    projectId: 'p-1',
    sessionId: 's-1',
    sourceKey: 'user:req-1',
    requestKey: 'req-1',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: '请只回复四个字：收到二字。' }] },
  });
  const defaults: RuntimeDefaults = {
    model: { providerId: config.provider, modelId: config.model },
    agentDir: agentEnv.agentDir,
    tools: [],
  };
  const runner = new InputRunner({
    store,
    registry: new SessionRegistry(new PiRuntimeFactory(defaults)),
    factory: new PiRuntimeFactory(defaults),
    resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server: defaults }),
  });

  const outcome = await runner.runNext('s-1');
  const elapsedMs = Date.now() - startedAt;
  const row = store.getInput('i-1');
  const rowCheckpoint = row?.checkpoint ?? '';
  const rowConfig = row?.effectiveConfig ?? '';
  const detail = outcome.kind === 'completed' ? outcome.detail : outcome.kind;

  check(
    'runner completed a real-model input and classified it from observed facts',
    outcome.kind === 'completed',
    `outcome=${outcome.kind} detail=${JSON.stringify(detail)} elapsedMs=${elapsedMs}`,
  );
  check(
    'the delivered boundary was recorded (marker + root input entry + Pi file)',
    rowCheckpoint.includes('inputEntryId') && rowCheckpoint.includes('inputMarkerId'),
    `checkpoint=${JSON.stringify(rowCheckpoint.slice(0, 160))}`,
  );
  check(
    'the redacted effective configuration was recorded without credentials',
    rowConfig.includes(config.model) && !/sk-|apiKey|"key"/i.test(rowConfig),
    `effectiveConfig=${JSON.stringify(rowConfig)}`,
  );
  check(
    'the input ended completed with a claim generation',
    row !== undefined && row.status === 'completed' && row.claim === 1 && row.serverEpoch === 1,
    `status=${String(row?.status)} claim=${String(row?.claim)} serverEpoch=${String(row?.serverEpoch)}`,
  );
} finally {
  store.close();
  await agentEnv.cleanup();
  rmSync(workspace, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} runner real-model checks passed`);
if (failed.length > 0) {
  process.exitCode = 1;
}