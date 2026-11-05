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
import { inProcessControl } from '../mcp/control.ts';
import { createMcpHttpHandler } from '../mcp/http.ts';
import { createMcpProtocol } from '../mcp/protocol.ts';
import { RunTools } from '../mcp/runs.ts';
import { registerCoreMethods } from './methods.ts';
import { registerReadMethods } from './read-methods.ts';
import { registerWriteMethods } from './write-methods.ts';
import { registerStreamMethods } from './stream-methods.ts';
import { liveHistoryRead } from './live-snapshot.ts';
import { projectEventImages } from './image-projection.ts';
import { SessionEventHub } from './hub.ts';
import { wakeForSettledStep } from './step-wake.ts';
import { epochOf } from '../runtime/epoch.ts';
import { closeInterruptedChiefInput, queueInterruptedMemberNotice } from './host-recovery.ts';
import { WorkbenchWorker } from './worker.ts';
import { InteractionBridge } from '../runtime/interactions.ts';
import { PiRuntimeFactory } from '../runtime/pi-runtime.ts';
import { SessionRegistry } from '../runtime/registry.ts';
import { InputRunner } from '../runtime/runner.ts';
import type { RunOutcome } from '../runtime/runner.ts';
import { resolveStoredConfig } from '../runtime/config.ts';
import type { RuntimeDefaults } from '../runtime/config.ts';
import { contextNoticeOf, contextUsageOf, windowOnlyContext, type ContextUsageView } from '../runtime/context-usage.ts';
import { recordedConfigOf, summarizeRecordedConfig } from '../runtime/recorded-config.ts';

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
  /**
   * Default timeout for a bash call that omits one (seconds; default 600, 0 disables). The tool
   * result is a timeout the model can act on, not a run abort.
   */
  readonly bashTimeoutSeconds?: number;
  readonly now?: () => string;
  /**
   * Where startup diagnostics go. Defaults to stderr: a caller that hosts this workbench inside
   * another protocol (the MCP stdio server) must keep fd 1 free for its own messages.
   */
  readonly log?: (line: string) => void;
}

export function startWorkbench(options: StartOptions): Promise<{
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}> {
  mkdirSync(options.dataDir, { recursive: true });
  const log = options.log ?? ((line: string): void => void process.stderr.write(`${line}\n`));
  // A new process is a new generation: the store classifies work left `processing` by an earlier
  // generation as interrupted, and a reconnecting reader resyncs instead of trusting a stale epoch.
  const serverEpoch = options.serverEpoch ?? Date.now() % 2_147_483_647;
  const store = new Store({ path: join(options.dataDir, 'state.db'), serverEpoch });
  // Work started by a process that is gone can never finish on its own: say so before serving.
  const startup = store.scanStartup();
  if (startup.interrupted > 0) {
    log(`${startup.interrupted} input(s) from an earlier run are now interrupted and await verification`);
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
      log(`host closed interrupted chief input ${frozen.inputId}`);
    } catch (error) {
      log(`could not close interrupted chief input ${frozen.inputId}: ${String(error)}`);
    }
  }
  // Tell the owning chief: an interrupted member input blocks its step (claim refuses the
  // session, task(op=update) reports STAGE_NOT_READY) and only the chief can verify it. Without
  // this notice the Task waits forever on work whose process is gone.
  for (const interrupted of store.listInterruptedTaskInputs()) {
    const notice = queueInterruptedMemberNotice(store, interrupted, 'was started by a process that is gone');
    if (notice.queued) {
      log(`recovery notice queued for chief ${interrupted.chiefSessionId} (input ${interrupted.inputId})`);
    }
  }
  // A settled step whose chief turn is gone (the process stopped, or a dispatch-owned member ended
  // after its turn) has no outcome left to report. Give the chief the same one turn the live path
  // gives it; the notice is deduped per step, so a restart cannot repeat it.
  for (const project of store.listProjectSummaries()) {
    for (const task of store.listTasks(project.id)) {
      try {
        const woke = wakeForSettledStep(store, task.id);
        if (woke.woken) log(`woke the chief for settled step of ${task.id} on startup (${woke.noticeId ?? ''})`);
      } catch (error) {
        log(
          `could not wake the chief for ${task.id} on startup: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
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
  const reportedWorkerErrors = new Map<string, string>();
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
    // The settings page lists the levels Pi would accept for a model; the rule lives in the same
    // runtime that creates the sessions, so the page cannot drift from the run.
    modelLevels: (selection) => factory.levelsFor(selection),
    // An alias borrows the real model's facts from the same catalogue a run reads (context window and
    // output cap included: they decide compaction and truncation, not just the effort list).
    modelFacts: (selection) => factory.facts(selection),
    catalogModels: () => factory.catalog(),
  });
  registerReadMethods(router, { store, blockedOf, attachmentDir: server.agentDir });

  // Live events (M4): the runner publishes what Pi reports, the write surface publishes invalidations.
  const hub = new SessionEventHub();
  const epoch = (sessionId: string): string =>
    epochOf({ serverEpoch: store.epoch, instanceGeneration: registry.generationOf(sessionId) });
  // The runner and its worker: inputs are stored by the write surface, then actually run here.
  const factory = new PiRuntimeFactory(server);
  const registry = new SessionRegistry(factory);
  /**
   * The context occupancy a reader sees. A live instance answers with its own estimate; without one
   * (a restart, a model change) only the window is knowable, and it is the window of the model the
   * session last ran with - or the one it would run with next when it has not run yet.
   *
   * The meter is optional telemetry: no failure here may take down the session stream, so the whole
   * read answers null instead of propagating.
   */
  const contextOf = async (sessionId: string): Promise<ContextUsageView | null> => {
    try {
      const handle = registry.get(sessionId);
      if (handle !== undefined) {
        return contextUsageOf(handle.session);
      }
      const session = store.getSession(sessionId);
      if (session === undefined) return null;
      const recorded = summarizeRecordedConfig(recordedConfigOf(store.listInputs(sessionId)));
      const selection =
        recorded ??
        resolveStoredConfig({ roleId: session.roleId, projectId: session.projectId, server, store }).selection;
      return windowOnlyContext((await factory.facts(selection))?.contextWindow);
    } catch {
      return null;
    }
  };
  const interactions = new InteractionBridge({
    store,
    publish: (sessionId, event, meta) => {
      hub.publish(sessionId, event, { ...(meta?.inputId !== undefined ? { inputId: meta.inputId } : {}) });
    },
  });
  /**
   * One handler for every run that settles: worker-owned runs and runs the chief's dispatch tool
   * started directly. The latter used to finish silently when the chief's turn had already ended.
   */
  const handleOutcome = (sessionId: string, outcome: RunOutcome): void => {
    reportedWorkerErrors.delete(sessionId);
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
      // The chief's dispatch wait lives in its own turn. When that turn is gone (wait timeout,
      // watchdog, provider error) nothing would consume a report that lands afterwards; wake the
      // chief once per settled step, whichever side just settled.
      const coordinated = taskId ?? store.getSession(sessionId)?.currentTaskId ?? null;
      if (coordinated !== null) {
        try {
          const woke = wakeForSettledStep(store, coordinated);
          if (woke.woken) log(`woke the chief for settled step of ${coordinated} (${woke.noticeId ?? ''})`);
        } catch (error) {
          log(
            `could not wake the chief for ${coordinated}: ` +
              (error instanceof Error ? error.message : String(error)),
          );
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
  };
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
    onRunSettled: handleOutcome,
    onEvent: (sessionId, event, meta) => {
      // A live message may carry image bytes; the browser only ever gets the attachment address (U6).
      hub.publish(sessionId, projectEventImages(event, server.agentDir) as typeof event, {
        inputId: meta.inputId,
        epoch: meta.epoch,
      });
      // Occupancy moves only when a response or a compaction lands. Pi emits message_end *before*
      // it appends the message, so the estimate is taken on a microtask: the append and the rest of
      // the run keep their order, and the reader's next frame is still in the same tick. Observation
      // must never break the run: a failed estimate leaves the last value until the next snapshot.
      const type = (event as { type?: unknown }).type;
      const assistant = (event as { message?: { role?: unknown } }).message?.role === 'assistant';
      if (!(type === 'message_end' && assistant) && type !== 'compaction_end') return;
      queueMicrotask(() => {
        try {
          const notice = contextNoticeOf(event, registry.get(sessionId)?.session);
          if (notice !== null) {
            hub.publish(sessionId, notice, { inputId: meta.inputId, epoch: meta.epoch });
          }
        } catch {
          // No frame; the next response or a resync will update the meter.
        }
      });
    },
    // A hung provider or a run that never ends must reach a terminal state, not block its
    // step, its Task and the user's queue forever.
    ...(options.runStallMs !== undefined ? { runStallMs: options.runStallMs } : {}),
    ...(options.runTotalMs !== undefined ? { runTotalMs: options.runTotalMs } : {}),
    ...(options.bashTimeoutSeconds !== undefined ? { bashTimeoutSeconds: options.bashTimeoutSeconds } : {}),
  });
;
  const worker = new WorkbenchWorker({
    store,
    runner,
    // A run that cannot start must say why (P-06): the reason reaches whoever is looking, instead of
    // leaving a queued input that looks like it might still run.
    onError: (sessionId, error) => {
      const detail = error instanceof Error ? error.message : String(error);
      if (reportedWorkerErrors.get(sessionId) === detail) return;
      reportedWorkerErrors.set(sessionId, detail);
      log(`worker error for ${sessionId}: ${detail}`);
    },
    onOutcome: handleOutcome,
  });
  registerWriteMethods(router, {
    store,
    attachmentDir: server.agentDir,
    notify: () => worker.notify(),
    stopInput: (sessionId, stop) => runner.requestStop(sessionId, stop),
    compactSession: (sessionId) => runner.compactManually(sessionId),
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
    attachmentDir: server.agentDir,
    epochOf: (sessionId) => epoch(sessionId),
    contextOf,
    compactingOf: (sessionId) => registry.get(sessionId)?.session.isCompacting ?? false,
    currentHistory: (sessionId) => {
      const handle = registry.get(sessionId);
      if (handle === undefined) return undefined;
      return liveHistoryRead(handle.sessionManager, server.agentDir);
    },
  });

  /**
   * The MCP endpoint (product module external-agents): other coding agents call the same router in
   * this process, so there is one server, one store and one dispatcher. A protocol instance per
   * request keeps the caller's identity attached to anything it answers.
   */
  const mcpHandler = createMcpHttpHandler({
    protocolFor: (actor) =>
      createMcpProtocol({
        tools: new RunTools({
          control: inProcessControl({ router, store, actor }),
          // The endpoint serves every project, so inheriting the server's cwd would delegate into
          // whatever directory it was started in. Remote callers name the project explicitly.
          defaultProjectPath: resolve(process.env['KAIMING_MCP_PROJECT'] ?? process.cwd()),
          requireProjectPath: process.env['KAIMING_MCP_PROJECT'] === undefined,
          caller: 'an MCP client',
        }),
        info: { name: 'kaiming', title: 'Kaiming', version: '0.1.0' },
        log: (line) => process.stderr.write(`[mcp] ${line}\n`),
      }),
  });
  const workbench = createWorkbenchServer({
    store,
    auth,
    router,
    hub,
    mcp: (request, response, actor) => mcpHandler.handle(request, response, actor),
    // The browser surface is served from the same origin (R1). The React build output is the
    // whole shell now: `web-static/index.html` plus hashed assets, mounted at `/`.
    staticDir: options.staticDir ?? resolve(here, '../../web-static'),
    // Uploaded chat images (U6): bytes on disk under the agent dir, addressed by digest.
    attachmentDir: server.agentDir,
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
  const accessPassword = process.env['KAIMING_ACCESS_PASSWORD'] ?? '';
  if (accessPassword.trim() === '') {
    process.stderr.write('KAIMING_ACCESS_PASSWORD is required to start the workbench\n');
    process.exit(2);
  }
  // Resolved here, so a relative value cannot reach the runtime as one (see the guard's privateDirs).
  const dataDir = resolve(process.cwd(), process.env['KAIMING_DATA_DIR'] ?? '.kaiming-data');
  const model = {
    providerId: process.env['KAIMING_MODEL_PROVIDER'] ?? 'unset',
    modelId: process.env['KAIMING_MODEL_ID'] ?? 'unset',
  };
  const port = Number(process.env['KAIMING_PORT'] ?? 4173);
  const host = process.env['KAIMING_HOST'] ?? '127.0.0.1';
  const runStallMs = Number(process.env['KAIMING_RUN_STALL_MS'] ?? '');
  const runTotalMs = Number(process.env['KAIMING_RUN_TOTAL_MS'] ?? '');
  const rawBashTimeout = process.env['KAIMING_BASH_TIMEOUT_SECONDS'];
  const bashTimeoutSeconds =
    rawBashTimeout === undefined || rawBashTimeout.trim() === '' ? undefined : Number(rawBashTimeout);
  const running = await startWorkbench({
    dataDir,
    accessPassword,
    port,
    host,
    model,
    ...(Number.isFinite(runStallMs) && runStallMs > 0 ? { runStallMs } : {}),
    ...(Number.isFinite(runTotalMs) && runTotalMs > 0 ? { runTotalMs } : {}),
    ...(bashTimeoutSeconds !== undefined && Number.isFinite(bashTimeoutSeconds) && bashTimeoutSeconds >= 0
      ? { bashTimeoutSeconds }
      : {}),
  });
  process.stdout.write(`workbench listening on ${running.origin} (data: ${dataDir})\n`);
  const shutdown = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
