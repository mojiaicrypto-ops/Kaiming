/**
 * Runnable entry for the workbench server: opens the store, binds the access password from the
 * environment and serves the same-origin HTTP surface.
 *
 * Nothing sensitive is printed: the access password is only read, and the startup line carries the
 * address and the data directory so the operator knows what is running.
 */
import { mkdirSync } from 'node:fs';
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
import { SessionEventHub } from './hub.ts';
import { epochOf } from '../runtime/epoch.ts';
import { WorkbenchWorker } from './worker.ts';
import { InteractionBridge } from '../runtime/interactions.ts';
import { PiRuntimeFactory } from '../runtime/pi-runtime.ts';
import { SessionRegistry } from '../runtime/registry.ts';
import { InputRunner } from '../runtime/runner.ts';
import { resolveEffectiveConfig } from '../runtime/config.ts';
import type { RuntimeDefaults } from '../runtime/config.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

export interface StartOptions {
  readonly dataDir: string;
  readonly accessPassword: string;
  readonly port: number;
  readonly host?: string;
  readonly promptDir?: string;
  readonly staticDir?: string;
  readonly model?: { readonly providerId: string; readonly modelId: string };
  readonly now?: () => string;
}

export function startWorkbench(options: StartOptions): Promise<{
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}> {
  mkdirSync(options.dataDir, { recursive: true });
  const store = new Store({ path: join(options.dataDir, 'state.db'), serverEpoch: 1 });
  const server: RuntimeDefaults = {
    model: options.model ?? { providerId: 'unset', modelId: 'unset' },
    agentDir: options.dataDir,
    promptDir: options.promptDir ?? resolve(here, '../../../docs/technicalnew/prompts'),
    tools: [],
  };
  const auth = new AuthService({ accessPassword: options.accessPassword });
  const router = new RpcRouter();
  registerCoreMethods(router, { store, server });
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
    resolveConfig: (roleId) => resolveEffectiveConfig({ roleId, server }),
    onEvent: (sessionId, event, meta) => {
      hub.publish(sessionId, event, { inputId: meta.inputId, epoch: meta.epoch });
    },
  });
  const worker = new WorkbenchWorker({ store, runner });
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
  registerStreamMethods(router, { store, hub, epochOf: (sessionId) => epoch(sessionId) });

  const workbench = createWorkbenchServer({
    store,
    auth,
    router,
    hub,
    ...(options.staticDir !== undefined ? { staticDir: options.staticDir } : {}),
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
  const dataDir = process.env['AGENTDEV_DATA_DIR'] ?? resolve(process.cwd(), '.agentdev-data');
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
