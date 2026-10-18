/**
 * Runnable entry for the workbench server: opens the store, binds the access password from the
 * environment and serves the same-origin HTTP surface.
 *
 * Nothing sensitive is printed: the access password is only read, and the startup line carries the
 * address and the data directory so the operator knows what is running.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../store/store.ts';
import { AuthService } from './auth.ts';
import { RpcRouter } from './rpc.ts';
import { createWorkbenchServer } from './http.ts';
import { registerCoreMethods } from './methods.ts';
import { registerReadMethods } from './read-methods.ts';
import { registerWriteMethods } from './write-methods.ts';
import { registerStreamMethods } from './stream-methods.ts';
import { liveHistoryRead } from './live-snapshot.ts';
import { SessionEventHub } from './hub.ts';
import { epochOf } from '../runtime/epoch.ts';
import { WorkbenchWorker } from './worker.ts';
import { InteractionBridge } from '../runtime/interactions.ts';
import { PiRuntimeFactory } from '../runtime/pi-runtime.ts';
import { SessionRegistry } from '../runtime/registry.ts';
import { InputRunner } from '../runtime/runner.ts';
import { resolveStoredConfig } from '../runtime/config.ts';
import type { RuntimeDefaults } from '../runtime/config.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

export interface StartOptions {
  readonly dataDir: string;
  /** Pi config directory (model/credential files); defaults to the data directory. */
  readonly agentDir?: string;
  readonly accessPassword: string;
  readonly port: number;
  readonly host?: string;
  readonly promptDir?: string;
  readonly staticDir?: string;
  readonly model?: { readonly providerId: string; readonly modelId: string };
  /** This process's generation: a restart must be distinguishable from the run it inherits. */
  readonly serverEpoch?: number;
  readonly now?: () => string;
}

export function startWorkbench(options: StartOptions): Promise<{
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}> {
  mkdirSync(options.dataDir, { recursive: true });
  // A new process is a new generation: the store classifies work left `processing` by an earlier
  // generation as interrupted, and a reconnecting reader resyncs instead of trusting a stale epoch.
  const serverEpoch = options.serverEpoch ?? Date.now() % 2_147_483_647;
  const store = new Store({ path: join(options.dataDir, 'state.db'), serverEpoch });
  // Work started by a process that is gone can never finish on its own: say so before serving.
  const startup = store.scanStartup();
  if (startup.interrupted > 0) {
    process.stdout.write(`${startup.interrupted} input(s) from an earlier run are now interrupted and await verification\n`);
  }
  const server: RuntimeDefaults = {
    model: options.model ?? { providerId: 'unset', modelId: 'unset' },
    agentDir: options.agentDir ?? options.dataDir,
    promptDir: options.promptDir ?? resolve(here, '../../../docs/technicalnew/prompts'),
    tools: [],
  };
  const auth = new AuthService({ accessPassword: options.accessPassword });
  const router = new RpcRouter();
  // The factory is the one the runner uses, so a saved provider is visible to the next claimed input.
  registerCoreMethods(router, {
    store,
    server,
    reloadRuntime: () => factory.reload(),
    probeModel: (selection) => factory.probe(selection),
  });
  registerReadMethods(router, { store });

  // Live events (M4): the runner publishes what Pi reports, the write surface publishes invalidations.
  const hub = new SessionEventHub();
  const epoch = (sessionId: string): string =>
    epochOf({ serverEpoch: store.epoch, instanceGeneration: registry.generationOf(sessionId) });
  // The runner and its worker: inputs are stored by the write surface, then actually run here.
  const factory = new PiRuntimeFactory(server);
  const registry = new SessionRegistry(factory);
  const interactions = new InteractionBridge({
    store,
    publish: (sessionId, event, meta) => {
      hub.publish(sessionId, event, { ...(meta?.inputId !== undefined ? { inputId: meta.inputId } : {}) });
    },
  });
  const runner = new InputRunner({
    store,
    registry,
    factory,
    interactions,
    // Overrides are read where they are saved: the same role/project resolution the config surface
    // reports is the one a claimed input actually runs with (R5).
    // Absolute, because the guard compares real paths: a relative data dir would otherwise be
    // resolved against each session's project and guard nothing.
    privateDirs: [...new Set([resolve(options.dataDir), resolve(server.agentDir)])],
    resolveConfig: (roleId, projectId) =>
      resolveStoredConfig({
        roleId,
        ...(projectId !== undefined ? { projectId } : {}),
        server,
        store,
      }),
    // Every Pi event the runner reports reaches the session's stream (M4): without this the page
    // shows a transcript that never fills in, even though the run really happened.
    onEvent: (sessionId, event, meta) => {
      hub.publish(sessionId, event, { inputId: meta.inputId, epoch: meta.epoch });
    },
  });
  /** The last block reported per session: a run that still cannot start must not repeat itself. */
  const reportedBlocks = new Map<string, string>();
  const worker = new WorkbenchWorker({
    store,
    runner,
    // A run that cannot start must say why (P-06): the reason reaches whoever is looking, instead of
    // leaving a queued input that looks like it might still run.
    onOutcome: (sessionId, outcome) => {
      // A member run settled (or failed): the chief's Task card must refresh now, not on its
      // 3s poll — the user watches member activity live here.
      if (outcome.kind === 'completed' || outcome.kind === 'failed' || outcome.kind === 'stopped' || outcome.kind === 'interrupted') {
        const input = store.getInput(outcome.inputId);
        const taskId = input?.taskId ?? null;
        if (taskId !== null) {
          const task = store.getTask(taskId);
          if (task !== undefined && task.chiefSessionId !== sessionId) {
            hub.publish(task.chiefSessionId, { type: 'invalidate', entity: 'task', id: taskId });
          }
        }
      }
      if (
        outcome.kind !== 'blocked_config' &&
        outcome.kind !== 'blocked_role' &&
        outcome.kind !== 'blocked_project'
      ) {
        reportedBlocks.delete(sessionId);
        return;
      }
      const signature = `${outcome.code}:${outcome.detail}`;
      if (reportedBlocks.get(sessionId) === signature) {
        // The worker retries every idle pass while the work waits: say it once, not four times a second.
        return;
      }
      reportedBlocks.set(sessionId, signature);
      hub.publish(
        sessionId,
        { type: 'blocked', code: outcome.code, detail: outcome.detail },
        { epoch: epoch(sessionId) },
      );
    },
  });
  registerWriteMethods(router, {
    store,
    notify: () => worker.notify(),
    stopInput: (sessionId, stop) => runner.requestStop(sessionId, stop),
    controlTask: (control) => runner.controlTask(control),
    invalidate: (sessionId, entity, id) => {
      hub.publish(sessionId, { type: 'invalidate', entity, id });
    },
    resolveInteraction: (interactionId, response) => interactions.resolve(interactionId, response),
  });
  registerStreamMethods(router, {
    store,
    hub,
    epochOf: (sessionId) => epoch(sessionId),
    currentHistory: (sessionId) => {
      const handle = registry.get(sessionId);
      if (handle === undefined) return undefined;
      return liveHistoryRead(handle.sessionManager);
    },
  });

  const workbench = createWorkbenchServer({
    store,
    auth,
    router,
    hub,
    // The browser surface is served from the same origin (R1); defaults to the shipped UI directory.
    staticDir: options.staticDir ?? resolve(here, '../../web'),
    // The React shell (webapp build) mounts at /app/ when its build output exists: two shells
    // coexist during the migration, the old one keeps serving /.
    ...(existsSync(resolve(here, '../../web-static/app/index.html'))
      ? { appStaticDir: resolve(here, '../../web-static/app') }
      : {}),
  });
  return workbench.listen(options.port, options.host ?? '127.0.0.1').then(({ origin, port }) => {
    worker.start();
    return {
      origin,
      port,
      close: async () => {
        interactions.clear();
        await worker.stop();
        await workbench.close();
        registry.disposeAll();
        auth.revokeAll();
        store.close();
      },
    };
  });
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === resolve(fileURLToPath(import.meta.url))) {
  const accessPassword = process.env['AGENTDEV_ACCESS_PASSWORD'] ?? '';
  if (accessPassword.trim() === '') {
    process.stderr.write('AGENTDEV_ACCESS_PASSWORD is required to start the workbench\n');
    process.exit(2);
  }
  // Resolved here, so a relative value cannot reach the runtime as one (see the guard's privateDirs).
  const dataDir = resolve(process.cwd(), process.env['AGENTDEV_DATA_DIR'] ?? '.agentdev-data');
  const model = {
    providerId: process.env['AGENTDEV_MODEL_PROVIDER'] ?? 'unset',
    modelId: process.env['AGENTDEV_MODEL_ID'] ?? 'unset',
  };
  const port = Number(process.env['AGENTDEV_PORT'] ?? 4173);
  const host = process.env['AGENTDEV_HOST'] ?? '127.0.0.1';
  const running = await startWorkbench({ dataDir, accessPassword, port, host, model });
  process.stdout.write(`workbench listening on ${running.origin} (data: ${dataDir})\n`);
  const shutdown = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
