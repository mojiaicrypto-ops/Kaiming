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
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { loadProduct } from '../../scripts/lib/e2e-runtime.mjs';
import { WEB_ORIGIN, bootStack, seedWork } from '../../scripts/lib/e2e-stack.mjs';

import { FIXTURE_PATH } from './fixture-path.mjs';
import { PREVIEW_MARKER } from './constants.mjs';

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

  return {
    htmlArtifactId: artifact.id,
    htmlWorkId: work.id,
    htmlRunId: artifactRun.id,
    htmlRequirementId: requirementId,
    requirementPath: `/projects/${harness.projectId}/requirements/${requirementId}`,
    runningRunId: runningRun.id,
    runningWorkId: runningWork.id,
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
  };
  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  state = { harness, probe, fixture };
  return state;
}

/** Closes the stack and the probe after the run. */
export async function closeBrowserStack() {
  if (state === null) return;
  const current = state;
  state = null;
  await current.probe.close();
  await current.harness.close();
}
