/**
 * The browser suite's own real stack (WP-12 T7a).
 *
 * `globalSetup` calls {@link openBrowserStack}; the module keeps the booted stack (and
 * the loopback attack probe) alive for the whole Playwright run, and `globalTeardown`
 * calls {@link closeBrowserStack}. The stack is the repository's real one —
 * `scripts/lib/e2e-stack.mjs` boots the real Core, daemon and BFF on ephemeral loopback
 * ports over a temporary Git project, with the offline Provider stub of
 * `scripts/e2e.mjs`. `AGENTDEV_HOME` points at the temp state directory, so the drill
 * can never touch the operator's real `~/.agentdev`.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { loadProduct } from '../../scripts/lib/e2e-runtime.mjs';
import { WEB_ORIGIN, bootStack, seedWork } from '../../scripts/lib/e2e-stack.mjs';

import { FIXTURE_PATH } from './fixture-path.mjs';
import { PREVIEW_MARKER, SENSITIVE_FILE_MARKER } from './constants.mjs';

/**
 * The preview artifact: a normal HTML explanation whose script also runs the three
 * attack samples AC-052 names (cookie, network, parent page).
 *
 * The script writes every outcome into `#attack-results` as JSON. The spec reads that
 * element through Playwright's own frame handle, so the evidence is the page's real
 * result and not a value injected by the test.
 */
export function attackArtifactHtml(probeUrl) {
  return `<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>HTML 说明产物</title></head>
<body>
<h1 id="marker">${PREVIEW_MARKER}</h1>
<p id="probe" data-probe="${probeUrl}">隔离预览攻击样例</p>
<pre id="attack-results"></pre>
<script>
(async () => {
  const probe = ${JSON.stringify(probeUrl)};
  const results = {
    marker: document.getElementById('marker') !== null,
    origin: String(window.origin),
    cookie: null,
    cookieError: null,
    parentDocument: null,
    parentError: null,
    topTitle: null,
    topTitleError: null,
    topNavigation: null,
    topNavigationError: null,
    localStorage: null,
    localStorageError: null,
    fetchProbe: null,
    fetchSameOrigin: null,
    xhrProbe: null,
    imageProbe: null
  };
  try { results.cookie = document.cookie; } catch (error) { results.cookieError = String(error && error.name); }
  try { results.parentDocument = String(window.parent.document.body.tagName); } catch (error) { results.parentError = String(error && error.name); }
  try { results.topTitle = String(window.top.document.title); } catch (error) { results.topTitleError = String(error && error.name); }
  try {
    window.parent.location.href = 'about:blank#attack';
    results.topNavigation = 'navigated';
  } catch (error) { results.topNavigationError = String(error && error.name); }
  try { window.localStorage.setItem('agentdev.attack', '1'); results.localStorage = 'wrote'; } catch (error) { results.localStorageError = String(error && error.name); }
  try {
    const answer = await fetch(probe + '/attack-fetch', { mode: 'no-cors' });
    results.fetchProbe = 'resolved:' + String(answer.status);
  } catch (error) { results.fetchProbe = 'rejected:' + String(error && error.name); }
  try {
    const answer = await fetch('/api/session');
    results.fetchSameOrigin = 'resolved:' + String(answer.status);
  } catch (error) { results.fetchSameOrigin = 'rejected:' + String(error && error.name); }
  results.xhrProbe = await new Promise((resolve) => {
    try {
      const request = new XMLHttpRequest();
      request.open('GET', probe + '/attack-xhr');
      request.onload = () => resolve('loaded:' + String(request.status));
      request.onerror = () => resolve('error');
      request.send();
    } catch (error) { resolve('threw:' + String(error && error.name)); }
  });
  results.imageProbe = await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve('loaded');
    image.onerror = () => resolve('error');
    image.src = probe + '/attack-image';
    window.setTimeout(() => resolve('timeout'), 3000);
  });
  document.getElementById('attack-results').textContent = JSON.stringify(results);
})();
</script>
</body>
</html>
`;
}

/** A loopback server the attack samples try to reach; it counts every non-probe hit. */
async function startAttackProbe() {
  const attacks = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (url.startsWith('/__agentdev_attack_count')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ attacks: attacks.length, paths: attacks }));
      return;
    }
    attacks.push(`${request.method ?? 'GET'} ${url}`);
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('probe');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    attacks,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Inserts one real Run row (the artifact and the AC-071 fixture both need one). */
function insertRun(harness, input) {
  const { store, product, projectId } = harness;
  return store.runs.insert({
    id: store.newId(),
    projectId,
    workId: input.workId,
    role: input.role,
    purpose: input.purpose,
    stage: input.stage,
    status: input.status,
    requiredChild: false,
    join: 'none',
    childIds: [],
    configSnapshotId: product.storage.sha256(`browser:config:${input.stage}`),
    contextSnapshotId: product.storage.sha256(`browser:context:${input.stage}`),
    dispatchSnapshotId: product.storage.sha256(`browser:dispatch:${input.stage}`),
    budgetAllocation: 10_000,
  });
}

/** The seeded fixture the specs read; one plain JSON object. */
function seedBrowserFixtures(harness, probeUrl) {
  const { store, artifacts } = harness;
  // A real Work with a real budget row (the artifact needs a Work to hang off), plus
  // the real ArtifactService, so the preview endpoint serves real blob bytes. The
  // artifact also needs its producing Run row (the schema's FK), so the fixture inserts
  // a completed artifact Run the way a real artifact-producing Run would look.
  const work = seedWork(harness, {
    intent: 'artifact',
    level: 'none',
    status: 'completed',
    goal: 'HTML 说明产物隔离预览（浏览器演练夹具）',
  });
  const artifactRun = insertRun(harness, {
    workId: work.id,
    role: 'chief',
    purpose: 'artifact',
    stage: 'Develop',
    status: 'completed',
  });
  const artifact = artifacts.createAgent({
    run: { id: artifactRun.id, workId: work.id, role: 'chief' },
    kind: 'explanation',
    mime: 'text/html',
    bytes: Buffer.from(attackArtifactHtml(probeUrl), 'utf8'),
  });
  const requirementId = store.newId();
  store.requirements.insert({
    id: requirementId,
    projectId: harness.projectId,
    workId: work.id,
    title: 'HTML 说明产物隔离预览',
    goal: '验证隔离预览、攻击样例与一次性下载',
    lifecycle: 'active',
    phase: 'execute',
    sourceRef: { kind: 'git', id: store.newId(), version: '1', path: '.agentdev/requirements' },
    recordVersion: 1,
    portableRef: {
      path: `.agentdev/requirements/${requirementId}`,
      revision: harness.seedRevision,
      hash: store.newId().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    },
    executionAvailability: 'local',
    evidenceAvailability: 'summary_only',
  });

  // A real running Run, so AC-071's "does not disturb a Run" can read back a real row.
  const runningWork = seedWork(harness, {
    level: 'L2',
    status: 'running',
    goal: 'AC-071 夹具：保持 running 的 Run',
  });
  const runningRun = insertRun(harness, {
    workId: runningWork.id,
    role: 'backend',
    purpose: 'implementation',
    stage: 'Develop',
    status: 'running',
  });

  // A real user-facing sensitive-file todo for the Inbox spec (WP-12 W2): the exact
  // `chief_action_required` payload `apps/daemon/src/tool-handler.ts` files when the
  // frozen sensitive-file table refuses a read (附录 A.2), hung off a real running Work
  // so the card names a real Run.
  const inboxWork = seedWork(harness, {
    level: 'L2',
    status: 'running',
    goal: 'AC-074 夹具：敏感文件用户待办',
  });
  const inboxRun = insertRun(harness, {
    workId: inboxWork.id,
    role: 'backend',
    purpose: 'implementation',
    stage: 'Develop',
    status: 'running',
  });
  // The refused file really exists at the repo root (with a secret-looking marker):
  // the spec asserts the marker never reaches the page, so this is a real negative
  // test and not a tautology. `.git/info/exclude` keeps it out of `git status`, so the
  // AC-002 spec's "no source change" assertion still reads a clean tree.
  mkdirSync(join(harness.repo, '.git', 'info'), { recursive: true });
  appendFileSync(join(harness.repo, '.git', 'info', 'exclude'), '\n.env\n', 'utf8');
  writeFileSync(join(harness.repo, '.env'), `${SENSITIVE_FILE_MARKER}=hunter2\n`, 'utf8');
  store.events.append({
    name: 'chief_action_required',
    entityId: inboxWork.id,
    entityVersion: 1,
    data: {
      workId: inboxWork.id,
      runId: inboxRun.id,
      role: 'backend',
      kind: 'sensitive_file',
      operationId: 'sensitive:.env:.env*',
      path: '.env',
      pattern: '.env*',
      action: 'read',
      configPolicy: 'strict',
      policyRevision: 1,
      reason: '该文件在敏感文件表内，请你本人处理（填写/更新/提供替代值）',
    },
  });

  // The explicit L3 confirmation interaction (AC-011). The real Orchestrator owns the
  // confirmation service, and the protocol answers `decision.resolve` through the same
  // instance (`attachOrchestrator`), so the page's confirm/decline button drives the
  // real gate rather than a fixture row. Two L3 Works are seeded: one for the confirm
  // path and one for the decline path, each with the Chief Run its question Artifact is
  // attributed to.
  const gateway = new harness.product.core.ModelGateway({
    config: harness.config,
    snapshots: harness.snapshots,
    // The page never runs a model here: the confirmation is a real Decision, and the
    // transport exists only because the gateway is part of the Orchestrator's contract.
    transport: {
      complete: () => Promise.resolve({ ok: true, text: 'ok', inputTokens: 1, outputTokens: 1 }),
    },
  });
  const orchestrator = new harness.product.core.Orchestrator({
    store,
    config: harness.config,
    snapshots: harness.snapshots,
    gateway,
  });
  harness.protocol.attachOrchestrator(orchestrator);
  harness.protocol.attachGateway(gateway);

  const l3Scope = {
    readPaths: ['src'],
    writePaths: ['src/db'],
    operations: ['read', 'edit'],
    networkTargets: [],
  };
  const l3Work = seedWork(harness, {
    level: 'L3',
    status: 'running',
    goal: 'AC-011 夹具：需确认的 L3 高风险交付',
  });
  const l3ChiefRun = insertRun(harness, {
    workId: l3Work.id,
    role: 'chief',
    purpose: 'analysis',
    stage: 'assess',
    status: 'running',
  });
  const l3Confirmation = orchestrator.confirmations.raise({
    workId: l3Work.id,
    runId: l3ChiefRun.id,
    goal: l3Work.goal,
    riskFlags: ['数据删除/迁移'],
    reason: 'the migration rewrites stored delivery rows and is not reversible in place',
    revision: harness.seedRevision,
    scope: l3Scope,
  });

  const declinedWork = seedWork(harness, {
    level: 'L3',
    status: 'running',
    goal: 'AC-011 夹具：将被拒绝的 L3 高风险交付',
  });
  const declinedChiefRun = insertRun(harness, {
    workId: declinedWork.id,
    role: 'chief',
    purpose: 'analysis',
    stage: 'assess',
    status: 'running',
  });
  const declinedConfirmation = orchestrator.confirmations.raise({
    workId: declinedWork.id,
    runId: declinedChiefRun.id,
    goal: declinedWork.goal,
    riskFlags: ['Secret'],
    reason: 'the change rewrites a stored credential',
    revision: harness.seedRevision,
    scope: l3Scope,
  });

  return {
    htmlArtifactId: artifact.id,
    l3WorkId: l3Work.id,
    l3RunId: l3ChiefRun.id,
    l3DecisionId: l3Confirmation.decisionId,
    l3DeclinedWorkId: declinedWork.id,
    l3DeclinedRunId: declinedChiefRun.id,
    l3DeclinedDecisionId: declinedConfirmation.decisionId,
    htmlWorkId: work.id,
    htmlRunId: artifactRun.id,
    htmlRequirementId: requirementId,
    requirementPath: `/projects/${harness.projectId}/requirements/${requirementId}`,
    runningRunId: runningRun.id,
    runningWorkId: runningWork.id,
    inboxWorkId: inboxWork.id,
    inboxRunId: inboxRun.id,
    inboxTodoId: `${inboxWork.id}:.env:.env*`,
  };
}

/**
 * A free loopback port, chosen by asking the OS and releasing it immediately.
 *
 * The single BFF has to be addressable by an exact origin (`protocol.md` §2), and the
 * host learns its own origin only after it binds, so this fixture pins the port and
 * tells the host which origin the browser will send (`webOrigins`). A tiny race with
 * another process exists and is retried by {@link openSwitcherStack}.
 */
async function freePort() {
  const server = createNetServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolve) => server.close(() => resolve()));
  return port;
}

/** The six level-2 headings every `content.md` carries (`requirements.md` §6). */
function requirementContent(title, completion = '无') {
  return [
    '<!-- record-version: 1 -->',
    `# ${title}`,
    '',
    '## 目标与背景',
    '浏览器切换演练：证明两个项目的页面、事件流与产物互不串。',
    '',
    '## 范围与行为',
    '只经由真实协议命令写入；不插入任何数据库行。',
    '',
    '## 验收说明',
    'AC-023 / AC-024 / AC-034：一个安装、一个入口、可切换、强隔离。',
    '',
    '## 已确认决定',
    '无',
    '',
    '## 未决问题',
    '无',
    '',
    '## 完成摘要',
    completion,
    '',
  ].join('\n');
}

/**
 * The two-project stack the G5 switcher spec drives (WP-12 T5.5).
 *
 * It is the **real host** (`startRuntime`): one installation home, one BFF, real
 * per-project daemons and real SQLite. Both projects are created through the real
 * `project.create` product path (real `git init`, initial commit and `agentdev/main`),
 * and each receives a real Git-backed Requirement and a real user Artifact through the
 * real `/rpc` and upload endpoints — **no seeded row is involved**, which is what the
 * G5 spec needs to tell A and B apart.
 */
export async function openSwitcherStack() {
  const { startRuntime } = await import('../../apps/daemon/src/main.ts');
  const core = await import('@agentdev/core');
  const base = mkdtempSync(join(tmpdir(), 'agentdev-browser-switch-'));
  const home = join(base, 'home');
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const runtime = await startRuntime({
    home,
    roots: [],
    execute: false,
    daemonPort: 0,
    webPort: port,
    adminPort: 0,
    webOrigins: [origin],
    secretBackend: 'file',
    trust: true,
    log: () => undefined,
  });
  const webUrl = `http://${runtime.web.host}:${String(runtime.web.port)}`;
  const adminUrl = `http://${runtime.admin.host}:${String(runtime.admin.port)}`;
  const installationToken = core.readInstallationCredential(home);

  const admin = async (body) => {
    const response = await fetch(`${adminUrl}/projects`, {
      method: 'POST',
      headers: { authorization: `Bearer ${installationToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  // Two brand-new projects, one per name, through `project.create`.
  const definitions = [
    { name: 'Alpha 项目', title: 'ALPHA-SWITCH-REQUIREMENT', file: 'alpha.md' },
    { name: 'Beta 项目', title: 'BETA-SWITCH-REQUIREMENT', file: 'beta.md' },
  ];
  const created = [];
  for (const definition of definitions) {
    const root = join(base, `repo-${definition.file.replace('.md', '')}`);
    mkdirSync(root, { recursive: true });
    const answer = await admin({ action: 'create', root, name: definition.name });
    if (answer.status !== 200 || answer.body.ok !== true) {
      throw new Error(`project.create failed: ${JSON.stringify(answer.body)}`);
    }
    created.push({ definition, root, project: answer.body.project });
  }

  // One login for the whole installation (the spec asserts there is never a second).
  const login = await fetch(`${webUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ token: installationToken }),
  });
  if (!login.ok) throw new Error(`the switcher stack login failed with ${String(login.status)}`);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const csrfToken = (await login.json()).csrfToken ?? '';

  const rpc = async (projectId, method, params, idempotencyKey) => {
    const response = await fetch(`${webUrl}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, cookie },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: `switch-${method}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
        method,
        projectId,
        params,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      }),
    });
    return { status: response.status, body: await response.json() };
  };

  const projects = [];
  for (const entry of created) {
    const projectId = entry.project.projectId;
    // A real Git-backed Requirement through `requirement.create`.
    const requirementAnswer = await rpc(
      projectId,
      'requirement.create',
      {
        title: entry.definition.title,
        goal: `${entry.definition.name} 的浏览器切换证据`,
        scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
        contentMarkdown: requirementContent(entry.definition.title),
      },
      `switch-requirement-${projectId}`,
    );
    if (requirementAnswer.body.ok !== true) {
      throw new Error(`requirement.create failed: ${JSON.stringify(requirementAnswer.body)}`);
    }
    // A real user Artifact through the real upload + first-message path (AC-084).
    const conversation = await rpc(projectId, 'conversation.create', {
      title: `${entry.definition.name} 会话`,
    });
    if (conversation.body.ok !== true) {
      throw new Error(`conversation.create failed: ${JSON.stringify(conversation.body)}`);
    }
    const conversationId = conversation.body.result.conversation.id;
    const form = new FormData();
    form.append('conversationId', conversationId);
    form.append(
      'file',
      new Blob([`# ${entry.definition.title}\n`], { type: 'text/markdown' }),
      entry.definition.file,
    );
    const uploaded = await fetch(`${webUrl}/artifacts/${projectId}/upload`, {
      method: 'POST',
      headers: { origin, cookie, 'x-csrf-token': csrfToken },
      body: form,
    });
    if (uploaded.status !== 201) {
      throw new Error(`upload answered ${String(uploaded.status)}: ${await uploaded.text()}`);
    }
    const attachment = await uploaded.json();
    const sent = await rpc(
      projectId,
      'conversation.message.send',
      { conversationId, body: entry.definition.title, attachmentIds: [attachment.attachmentId] },
      `switch-message-${projectId}`,
    );
    if (sent.body.ok !== true) {
      throw new Error(`conversation.message.send failed: ${JSON.stringify(sent.body)}`);
    }
    const workId = sent.body.result.workId;
    const artifacts = await rpc(projectId, 'artifact.list', { workId });
    const artifact = (artifacts.body.result?.items ?? []).find((item) => item.origin === 'user');
    if (artifact === undefined) throw new Error('the message produced no user Artifact');
    const prepared = await rpc(projectId, 'artifact.download.prepare', {
      artifactId: artifact.id,
    });
    const downloadToken = prepared.body.result?.downloadToken;
    if (typeof downloadToken !== 'string') {
      throw new Error(`artifact.download.prepare failed: ${JSON.stringify(prepared.body)}`);
    }
    // The real Requirement id, read back from the real projection.
    const listed = await rpc(projectId, 'requirement.list', {});
    const requirement = (listed.body.result?.items ?? []).find(
      (item) => item.title === entry.definition.title,
    );
    if (requirement === undefined) throw new Error('requirement.create produced no row');
    projects.push({
      projectId,
      name: entry.definition.name,
      root: entry.root,
      requirementId: requirement.id,
      requirementTitle: entry.definition.title,
      artifactId: artifact.id,
      downloadToken,
      workId,
      conversationId,
    });
  }

  // ---- The clone drill's source records (AC-087/AC-088/AC-089) -------------------
  //
  // Alpha is the producer. Its two extra records are created through the same real
  // `/rpc` commands every other row in this stack uses: one reaches `completed` through
  // the documented completion write entrance, one reaches `active` through
  // `requirement.start` and therefore really has a local Work on this installation.
  const alpha = projects[0];
  if (alpha === undefined) throw new Error('the switcher stack has no Alpha project');
  const completionSummary = '浏览器 clone 演练：需求池已交付。';
  const cloneTitles = {
    completed: 'CLONE-COMPLETED-REQUIREMENT',
    active: 'CLONE-ACTIVE-REQUIREMENT',
  };

  const completedCreate = await rpc(
    alpha.projectId,
    'requirement.create',
    {
      title: cloneTitles.completed,
      goal: 'clone 后仍可读完成摘要与代码引用',
      scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
      contentMarkdown: requirementContent(cloneTitles.completed, completionSummary),
    },
    `clone-completed-create-${alpha.projectId}`,
  );
  if (completedCreate.body.ok !== true) {
    throw new Error(
      `requirement.create (completed) failed: ${JSON.stringify(completedCreate.body)}`,
    );
  }
  const completedId = completedCreate.body.result.requirementId;
  const activate = await rpc(
    alpha.projectId,
    'requirement.save',
    { requirementId: completedId, patch: { lifecycle: 'active' } },
    `clone-completed-activate-${completedId}`,
  );
  if (activate.body.ok !== true) {
    throw new Error(`requirement.save (active) failed: ${JSON.stringify(activate.body)}`);
  }
  const complete = await rpc(
    alpha.projectId,
    'requirement.save',
    {
      requirementId: completedId,
      patch: {
        lifecycle: 'completed',
        completion: {
          completedAt: new Date().toISOString(),
          summary: completionSummary,
          codeRevision: 'a'.repeat(40),
          codeTree: 'b'.repeat(64),
          featureIds: [],
          verificationSummary: '浏览器 clone 演练；旧报告未迁移。',
          remainingIssues: [],
        },
      },
    },
    `clone-completed-finish-${completedId}`,
  );
  if (complete.body.ok !== true) {
    throw new Error(`requirement.save (completed) failed: ${JSON.stringify(complete.body)}`);
  }

  const activeCreate = await rpc(
    alpha.projectId,
    'requirement.create',
    {
      title: cloneTitles.active,
      goal: 'clone 后显示待继续并在用户继续前不启动 Run',
      scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
      contentMarkdown: requirementContent(cloneTitles.active),
    },
    `clone-active-create-${alpha.projectId}`,
  );
  if (activeCreate.body.ok !== true) {
    throw new Error(`requirement.create (active) failed: ${JSON.stringify(activeCreate.body)}`);
  }
  const activeId = activeCreate.body.result.requirementId;
  const start = await rpc(
    alpha.projectId,
    'requirement.start',
    { requirementId: activeId },
    `clone-active-start-${activeId}`,
  );
  if (start.body.ok !== true) {
    throw new Error(`requirement.start failed: ${JSON.stringify(start.body)}`);
  }

  // The real clone: Alpha's delivery branch is the default branch, so the clone checks
  // it out with the pool inside the commits — nothing is copied from disk state.
  const cloneRoot = join(base, 'repo-clone');
  execFileSync('git', ['clone', '--no-tags', '--', alpha.root, cloneRoot], { encoding: 'utf8' });
  const opened = await admin({ root: cloneRoot, trust: true });
  if (opened.status !== 200 || opened.body.ok !== true) {
    throw new Error(`opening the clone failed: ${JSON.stringify(opened.body)}`);
  }
  const cloneProjectId = opened.body.instance.projectId;
  const cloneListed = await rpc(cloneProjectId, 'requirement.list', {});
  if (cloneListed.body.ok !== true) {
    throw new Error(
      `the clone project did not answer requirement.list: ${JSON.stringify(cloneListed.body)}`,
    );
  }
  const cloneItems = cloneListed.body.result?.items ?? [];
  const findClone = (title) => cloneItems.find((item) => item.title === title);
  const clonedQueued = findClone(alpha.requirementTitle);
  const clonedCompleted = findClone(cloneTitles.completed);
  const clonedActive = findClone(cloneTitles.active);
  if (clonedQueued === undefined || clonedCompleted === undefined || clonedActive === undefined) {
    throw new Error(
      `the clone imported ${String(cloneItems.length)} records but not all three expected ones`,
    );
  }
  const cloneDrill = {
    projectId: cloneProjectId,
    root: cloneRoot,
    completionSummary,
    queued: { id: clonedQueued.id, title: clonedQueued.title },
    completed: { id: clonedCompleted.id, title: clonedCompleted.title },
    active: {
      id: clonedActive.id,
      title: clonedActive.title,
      executionAvailability: clonedActive.executionAvailability,
    },
  };

  return {
    webUrl,
    webOrigin: origin,
    installationToken,
    stateDir: home,
    projects,
    // The clone drill's project (AC-087/AC-088/AC-089). Alpha's two extra records were
    // produced through the real commands above, Alpha's repository was really cloned,
    // and the clone was opened through the admin project path into this same
    // installation; its per-project SQLite therefore starts empty.
    clone: cloneDrill,
    close: () => runtime.stop(),
  };
}

let state = null;

/** Boots the real stack once and writes the fixture file the specs read. */
export async function openBrowserStack() {
  if (state !== null) return state;
  const product = await loadProduct();
  const meta = {};
  const harness = await bootStack({ product, meta });
  // The BFF is on an ephemeral port, so its real origin is only known after the
  // listener started. In the deployed product the BFF's own origin already is
  // `WEB_ORIGIN`; here the same allow-list has to be extended with the actual loopback
  // origin, or the browser's own login POST would (correctly) be refused.
  if (!harness.allowedOrigins.includes(harness.webUrl)) {
    harness.allowedOrigins.push(harness.webUrl);
  }
  // The temp state dir is the installation home for this run: nothing here may read or
  // write the operator's real `~/.agentdev` (WP-11 runtime layout).
  process.env.AGENTDEV_HOME = harness.stateDir;
  const probe = await startAttackProbe();
  const seeded = seedBrowserFixtures(harness, probe.url);
  // The G5 switcher spec drives its own real host (two projects, one BFF); it boots
  // here so the browser suite pays for it once and closes it in teardown.
  const switcher = await openSwitcherStack();
  const fixture = {
    webUrl: harness.webUrl,
    webOrigin: WEB_ORIGIN,
    installationToken: harness.installationToken,
    projectId: harness.projectId,
    conversationId: harness.conversationId,
    repoRoot: harness.repo,
    seedRevision: harness.seedRevision,
    stateDir: harness.stateDir,
    daemonUrl: harness.daemonUrl,
    probeUrl: probe.url,
    playwrightVersion: process.env.AGENTDEV_BROWSER_VERSION ?? 'unknown',
    ...seeded,
    switcher: {
      webUrl: switcher.webUrl,
      webOrigin: switcher.webOrigin,
      installationToken: switcher.installationToken,
      stateDir: switcher.stateDir,
      projects: switcher.projects,
      // The clone project the portability spec drives (AC-087/AC-088/AC-089).
      clone: switcher.clone,
    },
  };
  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  state = { harness, probe, switcher, fixture };
  return state;
}

/** Closes the stack and the probe after the run. */
export async function closeBrowserStack() {
  if (state === null) return;
  const current = state;
  state = null;
  await current.probe.close();
  await current.switcher.close();
  await current.harness.close();
}
