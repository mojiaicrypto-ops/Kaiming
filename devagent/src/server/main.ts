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
import { closeInterruptedChiefInput } from './host-recovery.ts';
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
  /** Run watchdog: abort a run with no Pi activity for this long (default 15 min). */
  readonly runStallMs?: number;
  /** Run watchdog: abort a run exceeding this total duration (default 90 min). */
  readonly runTotalMs?: number;
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
  // A chief cannot resolve its own interrupted input (the claim gate refuses the session, so
  // it can never run) — yet that same gate freezes every later input of the session, the
  // user's messages included. The host closes those directly at startup, as the recovery
  // contract requires, and the chief is told what happened so it verifies the real state.
  for (const frozen of store.listInterruptedChiefInputs()) {
    try {
      closeInterruptedChiefInput(store, frozen.inputId, {
        code: 'process-restart',
        detail: 'the process that ran it is gone',
      });
      process.stdout.write(`host closed interrupted chief input ${frozen.inputId}\n`);
    } catch (error) {
      process.stdout.write(`could not close interrupted chief input ${frozen.inputId}: ${String(error)}\n`);
    }
  }
  // Tell the owning chief: an interrupted member input blocks its step (claim refuses the
  // session, task(op=update) reports STAGE_NOT_READY) and only the chief can verify it. Without
  // this notice the Task waits forever on work whose process is gone.
  for (const interrupted of store.listInterruptedTaskInputs()) {
    const noticeId = `notice-${interrupted.inputId}`;
    if (store.getInput(noticeId) !== undefined) continue;
    const chief = store.getSession(interrupted.chiefSessionId);
    if (chief === undefined) continue;
    store.acceptInput({
      inputId: noticeId,
      projectId: chief.projectId,
      sessionId: interrupted.chiefSessionId,
      taskId: interrupted.taskId,
      sourceKey: `recovery-notice:${interrupted.inputId}`,
      requestKey: noticeId,
      method: 'session.system_notice',
      kind: 'system_notice',
      payload: {
        content: [
          {
            type: 'text',
            text:
              `The host detected an interrupted run. Member input ${interrupted.inputId} ` +
              `(session ${interrupted.sessionId}, Task ${interrupted.taskId}` +
              `${interrupted.errorCode !== null ? `, code ${interrupted.errorCode}` : ''}) ` +
              'was started by a process that is gone, so its outcome is unknown. Verify the real ' +
              'state (investigator + expectedKind=recovery, or your own read-only checks), then ' +
              `close it with task(op=recover, sessionId=${interrupted.sessionId}, ` +
              'evidenceRefs=[...], resolution=completed|failed|stopped) citing that evidence. ' +
              'Do not assume it finished.',
          },
        ],
      },
    });
    process.stdout.write(`recovery notice queued for chief ${interrupted.chiefSessionId} (input ${interrupted.inputId})\n`);
  }
  const server: RuntimeDefaults = {
    model: options.model ?? { providerId: 'unset', modelId: 'unset' },
    agentDir: options.agentDir ?? options.dataDir,
    promptDir: options.promptDir ?? resolve(here, '../../../docs/technicalnew/prompts'),
    tools: [],
  };
  const auth = new AuthService({ accessPassword: options.accessPassword });
  const router = new RpcRouter();
  /**
   * The last block reported per session: a run that still cannot start must not repeat itself.
   * The same record answers "why is nothing running" for a reader who connects afterwards, so a
   * blocked state is never delivered once and lost.
   */
  const reportedBlocks = new Map<string, string>();
  const blockedOf = (sessionId: string): { code: string; detail: string } | null => {
    const signature = reportedBlocks.get(sessionId);
    if (signature === undefined) return null;
    const separator = signature.indexOf(':');
    return separator < 0
      ? { code: signature, detail: '' }
      : { code: signature.slice(0, separator), detail: signature.slice(separator + 1) };
  }
  // The factory is the one the runner uses, so a saved provider is visible to the next claimed input.
  registerCoreMethods(router, {
    store,
    server,
    reloadRuntime: () => factory.reload(),
    probeModel: (selection) => factory.probe(selection),
  });
  registerReadMethods(router, { store, blockedOf });

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
    // A Task created, updated or dispatched inside the chief's own run reaches the browser now:
    // the tool publishes no invalidate of its own, and the strip must not wait for a poll.
    onTaskChange: (chiefSessionId, taskId) => {
      hub.publish(chiefSessionId, { type: 'invalidate', entity: 'task', id: taskId });
      // A dispatch creates member sessions, so a rail that lists sessions is stale too.
      hub.publish(chiefSessionId, { type: 'invalidate', entity: 'session', id: chiefSessionId });
    },
    onEvent: (sessionId, event, meta) => {
      hub.publish(sessionId, event, { inputId: meta.inputId, epoch: meta.epoch });
    },
    // A hung provider or a run that never ends must reach a terminal state, not block its
    // step, its Task and the user's queue forever.
    ...(options.runStallMs !== undefined ? { runStallMs: options.runStallMs } : {}),
    ...(options.runTotalMs !== undefined ? { runTotalMs: options.runTotalMs } : {}),
  });
;
  const worker = new WorkbenchWorker({
    store,
    runner,
    // A run that cannot start must say why (P-06): the reason reaches whoever is looking, instead of
    // leaving a queued input that looks like it might still run.
    onOutcome: (sessionId, outcome) => {
      // A chief's own input is a conversation turn, and nobody but the host can close it: left
      // interrupted, it freezes the whole session (every later message waits on recovery). Close
      // it with what the host really observed; the chief's notice says the outcome is unknown.
      if (outcome.kind === 'interrupted') {
        const failed = store.getInput(outcome.inputId);
        try {
          closeInterruptedChiefInput(store, outcome.inputId, {
            code: 'run-aborted',
            detail: failed?.errorMessage ?? outcome.detail,
          });
        } catch {
          // The next startup closes it; a session must not be frozen by a failed convenience pass.
        }
      }
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
    blockedOf,
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
    // The browser surface is served from the same origin (R1). The React build output is the
    // whole shell now: `web-static/index.html` plus hashed assets, mounted at `/`.
    staticDir: options.staticDir ?? resolve(here, '../../web-static'),
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
  const runStallMs = Number(process.env['AGENTDEV_RUN_STALL_MS'] ?? '');
  const runTotalMs = Number(process.env['AGENTDEV_RUN_TOTAL_MS'] ?? '');
  const running = await startWorkbench({
    dataDir,
    accessPassword,
    port,
    host,
    model,
    ...(Number.isFinite(runStallMs) && runStallMs > 0 ? { runStallMs } : {}),
    ...(Number.isFinite(runTotalMs) && runTotalMs > 0 ? { runTotalMs } : {}),
  });
  process.stdout.write(`workbench listening on ${running.origin} (data: ${dataDir})\n`);
  const shutdown = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
