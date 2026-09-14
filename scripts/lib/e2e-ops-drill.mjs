/**
 * The operations drill (`pnpm test:e2e` check `ops.backup-restore`, WP-12 G11).
 *
 * This is the AC-064 evidence at the **product path**: instead of calling
 * `packages/core`'s backup services directly, the drill runs the installed `agentdev` CLI
 * as a real child process against a real `AGENTDEV_HOME` and a real Git project:
 *
 * 1. `agentdev start --root <repo>` boots the real daemon (real SQLite, real lock, real
 *    listeners); a Provider with a **real credential** is registered through
 *    `provider.upsert`, a message is sent through `conversation.message.send`, and the
 *    resulting Chief Run must reach `attempt.ready` and really call the loopback model.
 *    That is also the regression guard for the `secretRef` availability defect: a
 *    credential the Gateway cannot resolve would leave the Run unqueued.
 * 2. `agentdev backup --output <dir>` snapshots the live Project **and** the installation's
 *    Provider/Profile configuration, never a credential value.
 * 3. The installation state directory and the project are deleted, `agentdev restore`
 *    rebuilds them, and the restarted daemon is asked (through its own protocol) whether
 *    the previously active Run is `interrupted`.
 * 4. A second, credential-less installation restores the same backup: `status: blocked`
 *    with a leading `WARNING [PROVIDER_BLOCKED]` line, until the credential is re-entered
 *    from stdin and then rotated in place.
 * 5. `agentdev relocate` fails closed on a cross-root identity change and accepts an
 *    identity-preserving alias; `agentdev doctor` reports the environment; and on macOS the
 *    launchd unit is really loaded and unloaded under a temporary label and home.
 *
 * Nothing is seeded: every row the restore brings back was created by the product itself
 * (message → Work → Chief Run). Where the environment cannot execute a clause (systemd on
 * a macOS host, a busy default port), the evidence string says so explicitly.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { E2E_OPS_ACS } from './drill-acs.mjs';
import { cliJson, runCli, writeCliBootstrap } from './e2e-cli.mjs';
import {
  REPO_ROOT,
  ensure,
  git,
  httpRequest,
  initRepository,
  jsonOf,
  makeTempDir,
} from './e2e-runtime.mjs';

/** Default loopback ports the CLI's first Project binds (`reliability.md` §7). */
const DEFAULT_DAEMON_PORT = 4318;

/** How long the loopback model withholds its answer, keeping the Run live. */
const MODEL_DELAY_MS = 30_000;

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/** Whether any file under `root` contains `needle` (proves no credential was copied). */
function containsText(root, needle) {
  const walk = (path) => {
    const stat = statSync(path);
    if (stat.isDirectory()) return readdirSync(path).some((entry) => walk(join(path, entry)));
    if (!stat.isFile()) return false;
    return readFileSync(path, 'utf8').includes(needle);
  };
  return existsSync(root) ? walk(root) : false;
}

/** Whether the documented default daemon port is free on this host. */
async function defaultPortFree() {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(DEFAULT_DAEMON_PORT, '127.0.0.1', () => probe.close(() => done(true)));
  });
}

/** Polls `read` until it returns a value, or fails with the last observation. */
async function waitFor(read, what, timeoutMs = 60_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await read();
    if (last !== undefined && last !== null) return last;
    if (Date.now() >= deadline)
      throw new Error(`timed out waiting for ${what} (last: ${String(last)})`);
    await sleep(intervalMs);
  }
}

/**
 * Boots a real installation and creates real data through the product path.
 *
 * @returns {Promise<object>} the installation handle used by the drill
 */
export async function bootCredentialedInstallation() {
  ensure(
    await defaultPortFree(),
    `port ${String(DEFAULT_DAEMON_PORT)} is busy; the CLI has no port flag`,
  );
  const home = makeTempDir('agentdev-e2e-ops-home-');
  const repo = makeTempDir('agentdev-e2e-ops-repo-');
  initRepository(repo, {
    files: {
      'README.md': '# operations drill\n',
      'src/orders/cancel.ts': 'export const cancel = (): boolean => true;\n',
      'docs/agentdev/features/F-0a1b2c3d/README.md': '# 订单取消\n',
    },
  });
  const { cliEntry, daemonEntry } = writeCliBootstrap(home);
  const env = {
    AGENTDEV_HOME: home,
    AGENTDEV_SECRET_BACKEND: 'file',
    AGENTDEV_DAEMON_ENTRY: daemonEntry,
  };

  const started = runCli(cliEntry, ['start', '--root', repo], { env });
  ensure(
    started.code === 0,
    `agentdev start exited ${String(started.code)}:\n${started.stderr || started.stdout}`,
  );
  const record = JSON.parse(readFileSync(join(home, 'runtime.json'), 'utf8'));
  const instance = record.instances[0];
  const token = readFileSync(join(home, 'installation-token'), 'utf8').trim();

  const modelCalls = [];
  const model = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      modelCalls.push(Buffer.concat(chunks).toString('utf8'));
      // Withhold the answer: the Attempt must stay live while the backup runs.
      const timer = setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'ops-drill-completion',
            object: 'chat.completion',
            model: 'ops-drill-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'OPS-DRILL' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
          }),
        );
      }, MODEL_DELAY_MS);
      timer.unref();
      response.on('close', () => clearTimeout(timer));
    });
  });
  await new Promise((done) => model.listen(0, '127.0.0.1', done));
  const modelUrl = `http://127.0.0.1:${String(model.address().port)}/v1`;

  const rpc = async (method, params) => {
    const response = await httpRequest(
      `http://${instance.daemon.host}:${String(instance.daemon.port)}/rpc`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          type: 'request',
          id: `${method}-${String(Date.now())}`,
          method,
          params,
        }),
      },
    );
    const body = jsonOf(response);
    if (body.ok !== true) throw new Error(`${method} refused: ${JSON.stringify(body.error)}`);
    return body.result;
  };

  // A Provider with a **real credential**: the Gateway must resolve it before the Chief Run
  // can even be queued (the regression guard for the `secretRef` availability defect).
  const credentialValue = `sk-e2e-ops-${String(Date.now())}`;
  const provider = await rpc('provider.upsert', {
    provider: {
      type: 'openai-compatible',
      baseUrl: modelUrl,
      enabled: true,
      models: [
        {
          id: 'ops-drill-model',
          contextWindow: 32_000,
          maxOutputTokens: 2_048,
          reasoningLevels: ['off', 'low'],
          vision: false,
        },
      ],
    },
    secret: credentialValue,
  });
  ensure(
    provider.secretConfigured === true,
    `provider.upsert reports secretConfigured=${String(provider.secretConfigured)}`,
  );
  await rpc('config.save', {
    scope: 'global',
    patch: {
      roleOverrides: {
        chief: {
          providerId: provider.providerId,
          modelId: 'ops-drill-model',
          reasoning: 'off',
          skills: [],
          toolSubset: [],
          contextLimit: 16_000,
        },
      },
    },
  });

  const conversation = await rpc('conversation.create', { title: 'operations drill' });
  const sent = await rpc('conversation.message.send', {
    conversationId: conversation.conversationId,
    body: '解释 src/orders/cancel.ts 的取消逻辑',
    attachmentIds: [],
  });

  // `attempt.ready` is what turns the Attempt `starting → running` (`supervisor.ts` §998),
  // so a running Attempt plus a real model request is the product-path proof.
  const chiefRun = await waitFor(async () => {
    const listed = await rpc('run.list', { workId: sent.workId });
    const run = (listed.items ?? []).find((entry) => entry.role === 'chief');
    const attempt = (run?.attempts ?? []).find((entry) => entry.status === 'running');
    if (run === undefined || attempt === undefined) return undefined;
    return { run, attempt };
  }, 'the Chief Run to reach attempt.ready');
  await waitFor(
    () => (modelCalls.length > 0 ? true : undefined),
    'the loopback model to receive the credentialed call',
  );

  return {
    home,
    repo,
    env,
    cliEntry,
    daemonEntry,
    token,
    instance,
    projectId: instance.projectId,
    secretRef: `provider:${String(provider.providerId)}`,
    credentialValue,
    workId: sent.workId,
    runId: chiefRun.run.id,
    attemptId: chiefRun.attempt.id,
    modelCalls,
    rpc,
    stop: async () => {
      runCli(cliEntry, ['stop'], { env });
      model.closeAllConnections?.();
      await new Promise((done) => model.close(() => done(undefined)));
    },
  };
}

/**
 * Runs the operations checks; registered by `scripts/e2e.mjs`.
 *
 * @param {{ checks: import('./e2e-checks.mjs').CheckList, meta: Record<string, unknown> }} input
 */
export async function runOpsDrill({ checks, meta }) {
  await checks.check('ops.backup-restore', E2E_OPS_ACS, async () => {
    const facts = [];
    const install = await bootCredentialedInstallation();
    try {
      facts.push(
        `credentialed Provider ${install.secretRef} -> Chief Run ${install.runId} reached attempt.ready (Attempt ${install.attemptId} running) and the loopback model received ${String(install.modelCalls.length)} credentialed call(s)`,
      );

      // ---- backup while the Run is live ------------------------------------
      const backupDir = join(makeTempDir('agentdev-e2e-ops-backup-'), 'backup');
      const backup = runCli(install.cliEntry, ['backup', '--output', backupDir], {
        env: install.env,
      });
      ensure(
        backup.code === 0,
        `agentdev backup exited ${String(backup.code)}:\n${backup.stderr || backup.stdout}`,
      );
      const backupBody = cliJson(backup.stdout);
      const head = git(['rev-parse', 'HEAD'], install.repo).trim();
      ensure(backupBody.complete === true, `backup is not complete: ${JSON.stringify(backupBody)}`);
      ensure(
        backupBody.revision === head,
        `backup revision ${String(backupBody.revision)} != ${head}`,
      );
      ensure(
        backupBody.installation?.configCopied === true,
        'the backup did not carry the installation-level configuration',
      );
      ensure(
        Array.isArray(backupBody.secretRefs) && backupBody.secretRefs.includes(install.secretRef),
        `the backup did not record ${install.secretRef}`,
      );
      ensure(
        !containsText(backupDir, install.credentialValue),
        'the credential value reached the backup directory',
      );
      facts.push(
        `agentdev backup exit 0: revision ${head.slice(0, 12)}, complete, secretRefs ${JSON.stringify(backupBody.secretRefs)}, installation config copied, no credential value in the backup directory`,
      );

      // ---- stop, destroy the state and the project, restore -----------------
      const stopped = runCli(install.cliEntry, ['stop'], { env: install.env });
      ensure(stopped.code === 0, `agentdev stop exited ${String(stopped.code)}`);
      const stateDir = join(install.home, 'projects', install.projectId);
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(install.repo, { recursive: true, force: true });
      ensure(
        !existsSync(stateDir) && !existsSync(install.repo),
        'the damage step did not delete both paths',
      );

      const restore = runCli(install.cliEntry, ['restore', backupDir, '--root', install.repo], {
        env: install.env,
      });
      ensure(
        restore.code === 0,
        `agentdev restore exited ${String(restore.code)}:\n${restore.stderr || restore.stdout}`,
      );
      const restoreBody = cliJson(restore.stdout);
      ensure(restoreBody.status === 'ready', `restore status is ${String(restoreBody.status)}`);
      ensure(
        restoreBody.revision === head,
        `restored revision ${String(restoreBody.revision)} != ${head}`,
      );
      ensure(
        restoreBody.consistency?.treeMatches === true,
        'the restored tree does not match the manifest',
      );
      ensure(restoreBody.doctor?.ok === true, 'the restore doctor did not pass');
      ensure(
        (restoreBody.recovery?.interruptedRunIds ?? []).includes(install.runId),
        `the previously active Run was not parked interrupted: ${JSON.stringify(restoreBody.recovery)}`,
      );

      // ---- restart the daemon and ask the product about that Run ------------
      const restarted = runCli(install.cliEntry, ['start'], { env: install.env });
      ensure(
        restarted.code === 0,
        `agentdev start on the restored installation exited ${String(restarted.code)}:\n${restarted.stderr || restarted.stdout}`,
      );
      const restoredRuns = await install.rpc('run.list', { workId: install.workId });
      const parkedRun = (restoredRuns.items ?? []).find((entry) => entry.id === install.runId);
      ensure(
        parkedRun?.status === 'interrupted',
        `the restarted daemon reports Run ${install.runId} as ${String(parkedRun?.status)}`,
      );
      ensure(
        runCli(install.cliEntry, ['stop'], { env: install.env }).code === 0,
        'stop after the restart failed',
      );
      facts.push(
        `deleted ${stateDir} and the project; agentdev restore exit 0 (status ready, tree ${String(restoreBody.tree).slice(0, 12)}, doctor ok, Run ${install.runId} interrupted); restarted daemon reported it interrupted through its own protocol`,
      );

      // ---- a credential-less installation: blocked, then re-entered ---------
      const freshHome = makeTempDir('agentdev-e2e-ops-fresh-home-');
      const freshRepo = join(makeTempDir('agentdev-e2e-ops-fresh-repo-'), 'repo');
      const freshEnv = { ...install.env, AGENTDEV_HOME: freshHome };
      const blocked = runCli(install.cliEntry, ['restore', backupDir, '--root', freshRepo], {
        env: freshEnv,
      });
      ensure(blocked.code === 0, `the credential-less restore exited ${String(blocked.code)}`);
      const blockedBody = cliJson(blocked.stdout);
      ensure(
        blockedBody.status === 'blocked',
        `credential-less restore status is ${String(blockedBody.status)}`,
      );
      ensure(
        blocked.stdout.split('\n')[0].includes('WARNING [PROVIDER_BLOCKED]'),
        `the blocked restore did not lead with a warning line: ${blocked.stdout.split('\n')[0] ?? ''}`,
      );
      ensure(
        blockedBody.installation?.configRestored === true,
        'the backup did not restore the Provider/Profile definitions into the fresh installation',
      );
      const freshProviders = blockedBody.installation?.providers ?? [];
      ensure(
        freshProviders.some((entry) => entry.secretRef === install.secretRef),
        `the restored configuration does not carry ${install.secretRef}`,
      );
      ensure(
        !containsText(freshHome, install.credentialValue),
        'the credential value reached the fresh installation',
      );
      ensure(
        runCli(install.cliEntry, ['secret', 'set', install.secretRef], {
          env: freshEnv,
          input: `${install.credentialValue}\n`,
        }).code === 0,
        'agentdev secret set failed',
      );
      const ready = runCli(
        install.cliEntry,
        ['restore', backupDir, '--root', freshRepo, '--replace'],
        {
          env: freshEnv,
        },
      );
      ensure(ready.code === 0, `the re-credentialed restore exited ${String(ready.code)}`);
      ensure(cliJson(ready.stdout).status === 'ready', 'the re-credentialed restore is not ready');
      const rotated = runCli(install.cliEntry, ['secret', 'rotate', install.secretRef], {
        env: freshEnv,
        input: `${install.credentialValue}-rotated\n`,
      });
      ensure(rotated.code === 0, `agentdev secret rotate exited ${String(rotated.code)}`);
      const rotatedBody = cliJson(rotated.stdout);
      ensure(rotatedBody.rotated === true, 'secret rotate did not report a rotation');
      ensure(
        rotatedBody.capabilities?.revoked === 0,
        `secret rotate must not claim capability revocation, got ${String(rotatedBody.capabilities?.revoked)}`,
      );
      ensure(
        !rotated.stdout.includes(install.credentialValue),
        'secret rotate printed the credential value',
      );
      facts.push(
        `fresh installation restore: status blocked + first stdout line WARNING [PROVIDER_BLOCKED], Provider definitions carried (${String(freshProviders.length)}), no credential value in the fresh home; after stdin secret set the restore is ready; secret rotate exit 0 (capabilities.revoked=0, no value printed)`,
      );

      // ---- relocate: fail closed on identity, accept the same canonical root --
      const newRoot = `${install.repo}-moved`;
      const refused = runCli(
        install.cliEntry,
        ['relocate', install.projectId, '--root', newRoot, '--move'],
        { env: install.env },
      );
      ensure(refused.code === 1, `a cross-root relocate exited ${String(refused.code)}`);
      const refusal = JSON.parse(refused.stderr.trim());
      ensure(
        refusal.error?.code === 'PROJECT_IDENTITY_MOVE_UNSUPPORTED',
        `cross-root relocate code is ${String(refusal.error?.code)}`,
      );
      ensure(
        existsSync(join(install.repo, 'README.md')) && !existsSync(newRoot),
        'the refused relocate moved or deleted something',
      );
      const aliasParent = makeTempDir('agentdev-e2e-ops-alias-');
      const alias = join(aliasParent, 'repo-alias');
      symlinkSync(install.repo, alias);
      const aliased = runCli(install.cliEntry, ['relocate', install.projectId, '--root', alias], {
        env: install.env,
      });
      ensure(
        aliased.code === 0,
        `the identity-preserving relocate exited ${String(aliased.code)}:\n${aliased.stderr}`,
      );
      ensure(
        cliJson(aliased.stdout).identityPreserved === true,
        'the identity-preserving relocate did not report identityPreserved',
      );
      facts.push(
        `relocate --move to a different root refused with PROJECT_IDENTITY_MOVE_UNSUPPORTED and left the repository and registry untouched; relocate to an alias of the same canonical root accepted (identityPreserved)`,
      );

      // ---- doctor -----------------------------------------------------------
      const doctor = runCli(install.cliEntry, ['doctor'], { env: install.env });
      ensure(doctor.code === 0, `agentdev doctor exited ${String(doctor.code)}:\n${doctor.stdout}`);
      ensure(
        doctor.stdout.includes('execution ready: yes'),
        'agentdev doctor did not report the environment executable',
      );
      facts.push('agentdev doctor exit 0 with execution ready');

      // ---- the user service (macOS launchd; honest exclusion elsewhere) -----
      const service = await runLaunchdDrill(install.cliEntry);
      facts.push(service);
      if (service.includes('load/unload')) meta.opsService = 'launchd';
    } finally {
      await install.stop();
    }
    return facts.join('; ');
  });
}

/**
 * Loads and unloads the launchd unit under a temporary label and home.
 *
 * The unit is the shipped `apps/cli/templates/com.agentdev.daemon.plist` with the three
 * documented placeholders substituted; the label is temporary and the installation home is
 * a temporary directory, so nothing under `~/Library/LaunchAgents` or the real
 * `~/.agentdev` is touched. A non-macOS host (or a busy default port) is reported as an
 * honest exclusion instead of a silent skip.
 *
 * @param {string} cliEntry the generated CLI bootstrap
 * @returns {Promise<string>} the evidence (or the honest exclusion for this platform)
 */
async function runLaunchdDrill(cliEntry) {
  if (process.platform !== 'darwin') {
    return `launchd 单元未执行：本机平台是 ${process.platform}（macOS 专属；systemd 单元需 Linux 环境，见 installation.md §11）`;
  }
  if (!(await defaultPortFree())) {
    return `launchd 单元未执行：默认端口 ${String(DEFAULT_DAEMON_PORT)} 被占用（环境冲突，不是产品行为）`;
  }
  const label = 'com.agentdev.daemon.e2eops';
  const home = makeTempDir('agentdev-e2e-ops-launchd-');
  mkdirSync(join(home, 'logs'), { recursive: true });
  const template = readFileSync(
    join(REPO_ROOT, 'apps', 'cli', 'templates', 'com.agentdev.daemon.plist'),
    'utf8',
  );
  const plist = join(home, `${label}.plist`);
  writeFileSync(
    plist,
    template
      .replaceAll('__NODE__', process.execPath)
      .replaceAll('__AGENTDEV_REPO__', REPO_ROOT)
      .replaceAll('__AGENTDEV_HOME__', home)
      .replaceAll('com.agentdev.daemon', label),
    'utf8',
  );
  const uid = String(process.getuid?.() ?? 501);
  let pid = null;
  let recorded = false;
  try {
    const bootstrap = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, plist], {
      encoding: 'utf8',
    });
    ensure(
      bootstrap.status === 0,
      `launchctl bootstrap exited ${String(bootstrap.status)}: ${bootstrap.stderr}`,
    );
    const launched = await waitFor(
      () => {
        const path = join(home, 'runtime.json');
        return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
      },
      'the launchd service to publish a runtime record',
      30_000,
    );
    pid = launched.pid;
    const status = runCli(cliEntry, ['status'], { env: { ...process.env, AGENTDEV_HOME: home } });
    ensure(
      status.code === 0 && cliJson(status.stdout).running === true,
      `agentdev status against the launchd home is ${status.stdout.trim()}`,
    );
    ensure(existsSync(join(home, 'daemon.lock')), 'the launchd daemon does not hold daemon.lock');
    recorded = true;
  } finally {
    spawnSync('launchctl', ['bootout', `gui/${uid}/${label}`], { encoding: 'utf8' });
    await sleep(500);
    if (recorded) {
      const gone = await waitFor(
        () => (!existsSync(join(home, 'runtime.json')) ? true : undefined),
        'the launchd service to stop',
        30_000,
      ).catch(() => false);
      ensure(gone === true, 'the launchd service left a runtime record behind after bootout');
      ensure(
        !existsSync(join(home, 'daemon.lock')),
        'the launchd service left daemon.lock behind after bootout',
      );
    }
  }
  return `launchd 单元 load/unload：bootstrap gui/${uid} exit 0, daemon pid ${String(pid)} published runtime.json and held daemon.lock, agentdev status running:true, bootout removed the record and the lock`;
}
