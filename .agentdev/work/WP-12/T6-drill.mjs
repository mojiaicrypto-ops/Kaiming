#!/usr/bin/env node
/**
 * WP-12 T6 operations drill (real, on this machine).
 *
 * Reproduces the documented sequence with **real** artefacts and **real** CLI subprocess
 * invocations (`docs/architecture/reliability.md` §8):
 *
 *   start the daemon -> create a registered Project and a live Run through the product path
 *   -> `agentdev backup` -> delete the installation state and the project -> `agentdev restore`
 *   -> `agentdev start/status/doctor` -> verify SQLite rows, Git revision, leases/grants,
 *   interrupted Run -> `agentdev relocate` to a new root -> `agentdev start` again.
 *
 * Every command is printed with its stdout/stderr and its real exit code. Nothing under the
 * user's real `~/.agentdev` is touched: `AGENTDEV_HOME` points at a fresh temp directory.
 *
 * Usage: node .agentdev/work/WP-12/T6-drill.mjs
 */
import { spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const CLI = join(repoRoot, 'apps/cli/dist/cli.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}\n`);
  if (!ok) failures += 1;
};

/** Runs one CLI command exactly as the shell would, printing the transcript. */
function shell(args, env, options = {}) {
  const line = `$ agentdev ${args.join(' ')}`;
  process.stdout.write(`${line}\n`);
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    ...options,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.stdout.write(`[exit ${String(result.status)}]\n\n`);
  return { code: result.status ?? -1, out: result.stdout ?? '', err: result.stderr ?? '' };
}

/**
 * Parses a command's JSON result.
 *
 * `backup`/`restore` print operator-facing `WARNING [CODE] …` lines before the JSON, so a
 * consumer reads from the first `{` (`docs/operations/installation.md` §6).
 */
function json(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON in output: ${text}`);
  return JSON.parse(text.slice(start));
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

function git(args, cwd) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// ---------------------------------------------------------------------------
// 1. A temp installation home and a temp Git project
// ---------------------------------------------------------------------------

const home = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t6-home-')));
const repo = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t6-repo-')));
const backupDir = join(home, 'backup');
mkdirSync(join(home, 'logs'), { recursive: true, mode: 0o700 });
const env = { AGENTDEV_HOME: home, AGENTDEV_SECRET_BACKEND: 'file' };

// The daemon uses the documented default loopback ports for its first Project, and the CLI
// has no port flag (`reliability.md` §7), so the drill waits for them to be free instead of
// starting a second installation on the same ports.
const portBusy = () =>
  new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(true));
    probe.listen(4318, '127.0.0.1', () => probe.close(() => done(false)));
  });
for (let waited = 0; ; waited += 1) {
  if (!(await portBusy())) break;
  if (waited >= 60) {
    process.stderr.write('port 4318 is in use; stop other daemons (agentdev stop) first\n');
    process.exit(2);
  }
  if (waited === 0) process.stdout.write('port 4318 busy; waiting for it to free up...\n');
  await new Promise((done) => setTimeout(done, 5_000));
}
// Never leave a daemon behind, even when an assertion throws.
process.on('exit', () => {
  spawnSync(process.execPath, [CLI, 'stop'], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
});

process.stdout.write(`# WP-12 T6 operations drill\n\n`);
process.stdout.write(`AGENTDEV_HOME=${home}\nproject root=${repo}\nbackup dir=${backupDir}\n\n`);

git(['init', '--quiet', '-b', 'agentdev/main'], repo);
mkdirSync(join(repo, 'src/orders'), { recursive: true });
mkdirSync(join(repo, 'docs/agentdev/features/F-0a1b2c3d'), { recursive: true });
writeFileSync(join(repo, 'README.md'), '# drill project\n');
writeFileSync(join(repo, 'src/orders/cancel.ts'), 'export const cancel = (): boolean => true;\n');
writeFileSync(join(repo, 'docs/agentdev/features/F-0a1b2c3d/README.md'), '# 订单取消\n');
git(['add', '-A'], repo);
git(
  [
    '-c',
    'user.name=AgentDev Drill',
    '-c',
    'user.email=drill@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'chore: seed drill project',
  ],
  repo,
);
const seedRevision = git(['rev-parse', 'HEAD'], repo);
process.stdout.write(`seed revision=${seedRevision}\n\n`);

// ---------------------------------------------------------------------------
// 2. A real daemon plus a real live Run through the product path
// ---------------------------------------------------------------------------

// A loopback model that accepts the connection and never answers, so the Attempt stays
// live while the backup runs (the Run must be *active* to prove restore parks it).
const modelCalls = [];
const model = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    modelCalls.push(`${request.method ?? 'GET'} ${request.url ?? '/'}`);
    // Deliberately no answer: the Runner keeps the Attempt running.
    void response;
  });
});
await new Promise((done) => model.listen(0, '127.0.0.1', done));
const modelBaseUrl = `http://127.0.0.1:${String(model.address().port)}/v1`;

shell(['start', '--root', repo], env);

const token = readFileSync(join(home, 'installation-token'), 'utf8').trim();
const record = json(readFileSync(join(home, 'runtime.json'), 'utf8'));
const instance = record.instances[0];
const rpc = async (method, params) => {
  const payload = JSON.stringify({
    v: 1,
    type: 'request',
    id: `${method}-${Date.now()}`,
    method,
    params,
  });
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(
      `http://${instance.daemon.host}:${String(instance.daemon.port)}/rpc`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, body: json(text) });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
  if (response.body.ok !== true) {
    throw new Error(`${method} refused: ${JSON.stringify(response.body.error)}`);
  }
  return response.body.result;
};

// The Chief Run is queued only when the role's Provider is *usable*. The current tree
// refuses a Provider whose `secretRef` cannot be resolved under the Run's Grants
// (see the gap list in T6-implementation.md), so the live Provider here is registered
// without a credential and the credential-bearing Provider is added afterwards, purely so
// the backup records the Secret *identifiers* a restore must be able to resolve.
const provider = await rpc('provider.upsert', {
  provider: {
    type: 'openai-compatible',
    baseUrl: modelBaseUrl,
    enabled: true,
    models: [
      {
        id: 't6-drill-model',
        contextWindow: 32_000,
        maxOutputTokens: 2_048,
        reasoningLevels: ['off', 'low'],
        vision: false,
      },
    ],
  },
});
const config = await rpc('config.save', {
  scope: 'global',
  patch: {
    roleOverrides: {
      chief: {
        providerId: provider.providerId,
        modelId: 't6-drill-model',
        reasoning: 'off',
        skills: [],
        toolSubset: [],
        contextLimit: 16_000,
      },
    },
  },
});
process.stdout.write(
  `provider.upsert -> providerId=${provider.providerId} secretConfigured=${String(provider.secretConfigured)}\n`,
);
process.stdout.write(`config.save -> revision=${String(config.revision)}\n`);

const conversation = await rpc('conversation.create', { title: 'T6 drill' });
const sent = await rpc('conversation.message.send', {
  conversationId: conversation.conversationId,
  body: '实现 src/orders/cancel.ts 的取消逻辑',
  attachmentIds: [],
});
process.stdout.write(
  `conversation.message.send -> messageId=${sent.messageId} workId=${sent.workId}\n`,
);

let activeRun = null;
let runs = [];
for (let attempt = 0; attempt < 60 && activeRun === null; attempt += 1) {
  await new Promise((done) => setTimeout(done, 500));
  const listed = await rpc('run.list', { workId: sent.workId });
  runs = listed.items ?? [];
  activeRun = runs.find((run) => run.status === 'running') ?? null;
}
process.stdout.write(
  `runs -> ${JSON.stringify(runs.map((run) => ({ id: run.id, role: run.role, status: run.status })))}\n`,
);
process.stdout.write(`model calls received so far: ${String(modelCalls.length)}\n\n`);
check('a real Run is running through the product path', activeRun !== null, activeRun?.id ?? 'none');
const activeRunId = activeRun?.id ?? '';

const credentialValue = `sk-t6-drill-${String(Date.now())}`;
const credentialed = await rpc('provider.upsert', {
  provider: {
    type: 'openai-compatible',
    baseUrl: modelBaseUrl,
    enabled: true,
    models: [
      {
        id: 't6-drill-model-2',
        contextWindow: 32_000,
        maxOutputTokens: 2_048,
        reasoningLevels: ['off'],
        vision: false,
      },
    ],
  },
  secret: credentialValue,
});
process.stdout.write(
  `provider.upsert (with credential) -> providerId=${credentialed.providerId} secretConfigured=${String(
    credentialed.secretConfigured,
  )}\n\n`,
);

// ---------------------------------------------------------------------------
// 3. backup (installation running, Run active)
// ---------------------------------------------------------------------------

const backup = shell(['backup', '--output', backupDir], env);
const backupBody = json(backup.out);
check('backup exited 0', backup.code === 0);
check('backup manifest is complete', backupBody.complete === true);
check('backup recorded the delivery revision', backupBody.revision === seedRevision);
check(
  'backup recorded the Provider secret identifier, never a value',
  Array.isArray(backupBody.secretRefs) && backupBody.secretRefs.length === 1,
  JSON.stringify(backupBody.secretRefs),
);

// ---------------------------------------------------------------------------
// 4. damage: stop, then delete the state and the project data
// ---------------------------------------------------------------------------

const stopped = shell(['stop'], env);
check('stop exited 0', stopped.code === 0);
const projectId = instance.projectId;
const stateDir = join(home, 'projects', projectId);
rmSync(stateDir, { recursive: true, force: true });
rmSync(repo, { recursive: true, force: true });
process.stdout.write(`damaged: removed ${stateDir} and ${repo}\n`);
check('installation state is gone', !existsSync(stateDir));
check('project data is gone', !existsSync(repo));

// ---------------------------------------------------------------------------
// 5. restore
// ---------------------------------------------------------------------------

const restore = shell(['restore', backupDir, '--root', repo], env);
const restoreBody = json(restore.out);
check('restore exited 0', restore.code === 0);
check('restore reports ready', restoreBody.status === 'ready');
check(
  'restore marks the previously active Run interrupted',
  Array.isArray(restoreBody.recovery?.interruptedRunIds) &&
    restoreBody.recovery.interruptedRunIds.includes(activeRunId),
  JSON.stringify(restoreBody.recovery?.interruptedRunIds ?? []),
);
check('restore passed its doctor', restoreBody.doctor?.ok === true);
check('restore verified the tree against the manifest', restoreBody.consistency?.treeMatches === true);
check('restore rewrote the installation root mapping', restoreBody.registryUpdated === true);
process.stdout.write(
  `restore recovery: interrupted=${JSON.stringify(restoreBody.recovery?.interruptedRunIds ?? [])} revokedLeases=${String(
    restoreBody.recovery?.revokedLeases ?? -1,
  )} revokedGrants=${String(restoreBody.recovery?.revokedGrants ?? -1)}\n`,
);

const restoredRevision = git(['rev-parse', 'HEAD'], repo);
check('restored Git revision matches the backup', restoredRevision === seedRevision, restoredRevision);

// The restored SQLite must carry the original rows, revoked authority and the parked Run.
const storage = await import(pathToFileURL(join(repoRoot, 'packages/storage/dist/index.js')).href);
const store = storage.ProjectStore.open({ dataDir: stateDir, projectId });
try {
  const run = store.runs.find(activeRunId);
  check('restored Run row is interrupted', run?.status === 'interrupted', run?.status ?? 'missing');
  check('restored installation keeps its Work row', store.works.list().length >= 1);
  check('restored installation has no live lease', store.leases_.list({}).length === 0);
  const liveGrants = store.grants
    .list({ orderBy: 'created_at ASC' })
    .filter((grant) => grant.consumedAt === undefined).length;
  check('restored installation has no unconsumed Grant', liveGrants === 0);
  check(
    'restored installation carries the original rows (project, work, message)',
    store.projects.list().length === 1 &&
      store.works.list().length >= 1 &&
      store.messages.list().length >= 1,
    `projects=${String(store.projects.list().length)} works=${String(
      store.works.list().length,
    )} messages=${String(store.messages.list().length)}`,
  );
} finally {
  store.close();
}

// ---------------------------------------------------------------------------
// 6. start again + status + doctor
// ---------------------------------------------------------------------------

const restarted = shell(['start'], env);
check('daemon starts on the restored installation', restarted.code === 0);
const status = shell(['status'], env);
check('status reports the restored Project open', json(status.out).running === true);
const doctor = shell(['doctor'], env);
process.stdout.write(`doctor exit ${String(doctor.code)} (env probe)\n\n`);

// ---------------------------------------------------------------------------
// 6b. the same backup into an installation that has no credential: blocked
// ---------------------------------------------------------------------------

shell(['stop'], env);
const freshHome = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t6-fresh-home-')));
const freshRepo = join(realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t6-fresh-repo-'))), 'repo');
const freshEnv = { AGENTDEV_HOME: freshHome, AGENTDEV_SECRET_BACKEND: 'file' };
const blocked = shell(['restore', backupDir, '--root', freshRepo], freshEnv);
const blockedBody = json(blocked.out);
check('a restore without the credential is blocked, not failed', blocked.code === 0);
check('the blocked restore reports the Provider blocked', blockedBody.status === 'blocked');
check(
  'the blocked restore names the ref the operator must re-enter',
  Array.isArray(blockedBody.provider?.missingSecretRefs) &&
    blockedBody.provider.missingSecretRefs.length === 1 &&
    Array.isArray(blockedBody.nextSteps) &&
    blockedBody.nextSteps.length === 1,
  JSON.stringify(blockedBody.nextSteps),
);
check(
  'the blocked Provider is a leading stdout warning line',
  blocked.out.split('\n')[0].includes('WARNING [PROVIDER_BLOCKED]'),
  blocked.out.split('\n')[0],
);
check(
  'the backup carries the Provider definition into the fresh installation',
  blockedBody.installation?.configRestored === true &&
    (blockedBody.installation?.providers ?? []).some((provider) =>
      provider.models.includes('t6-drill-model-2'),
    ),
  JSON.stringify(blockedBody.installation?.providers ?? []),
);
check(
  'no credential value reached the backup or the fresh installation',
  !containsText(backupDir, credentialValue) && !containsText(freshHome, credentialValue),
);
const secretRef = blockedBody.provider.missingSecretRefs[0];
const freshSet = shell(['secret', 'set', secretRef], freshEnv, { input: `${credentialValue}\n` });
check('the credential can be re-entered from stdin', freshSet.code === 0);
const rotated = shell(['secret', 'rotate', secretRef], freshEnv, {
  input: `${credentialValue}-rotated\n`,
});
check(
  'the credential can be rotated in place',
  rotated.code === 0 && json(rotated.out).rotated === true,
  JSON.stringify(json(rotated.out).capabilities ?? {}),
);
check('rotation never prints either value', !rotated.out.includes(credentialValue));

// ---------------------------------------------------------------------------
// 7. relocate
// ---------------------------------------------------------------------------

shell(['stop'], env);
const newRoot = `${repo}-moved`;
const refused = shell(['relocate', projectId, '--root', newRoot, '--move'], env);
const refusedBody = JSON.parse(refused.err.trim());
check(
  'relocate fails closed on a cross-root move (typed refusal)',
  refused.code === 1 && refusedBody.error.code === 'PROJECT_IDENTITY_MOVE_UNSUPPORTED',
  refusedBody.error?.code,
);
check(
  'the refused relocate moved nothing and rewrote no mapping',
  existsSync(join(repo, 'README.md')) && !existsSync(newRoot),
);
const registryAfterRefusal = json(readFileSync(join(home, 'projects.json'), 'utf8'));
check(
  'the installation registry still points at the original root',
  registryAfterRefusal.projects.some((entry) => entry.root === repo && entry.projectId === projectId),
  JSON.stringify(registryAfterRefusal.projects.map((entry) => entry.root)),
);

// An identity-preserving target (a path alias to the same canonical root) is accepted.
const aliasParent = realpathSync(mkdtempSync(join(tmpdir(), 'agentdev-t6-alias-')));
const alias = join(aliasParent, 'repo-alias');
symlinkSync(repo, alias);
const aliased = shell(['relocate', projectId, '--root', alias], env);
const aliasedBody = json(aliased.out);
check(
  'relocate accepts a target that resolves to the same canonical root',
  aliased.code === 0 && aliasedBody.identityPreserved === true && aliasedBody.daemonOpenable === true,
);
const restartedAfterRelocate = shell(['start'], env);
check('the daemon starts on the identity-preserving installation', restartedAfterRelocate.code === 0);
const movedState = join(home, 'projects', projectId);
const stateStore = storage.ProjectStore.open({ dataDir: movedState, projectId });
try {
  check(
    'the migrated state still carries its rows (works=1, Run interrupted)',
    stateStore.works.list().length === 1 &&
      stateStore.runs.find(activeRunId)?.status === 'interrupted',
    `works=${String(stateStore.works.list().length)} run=${String(
      stateStore.runs.find(activeRunId)?.status,
    )}`,
  );
} finally {
  stateStore.close();
}
shell(['stop'], env);

process.stdout.write(`\nmodel calls total: ${String(modelCalls.length)}\n`);
process.stdout.write(failures === 0 ? '\nDRILL PASS\n' : `\nDRILL FAIL (${String(failures)})\n`);
model.close();
process.exit(failures === 0 ? 0 : 1);
