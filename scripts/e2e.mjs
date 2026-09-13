#!/usr/bin/env node
/**
 * `pnpm test:e2e` — the headless release end-to-end drill (WP-10 T2, `docs/delivery/implementation.md` §3).
 *
 * This is not a component test. It boots the **real product** in one process and
 * drives it exactly as the deployed workbench would:
 *
 * - a real temporary Git project (`agentdev/main`), a real SQLite `ProjectStore`,
 *   the real Core services, the real `createDaemon` (HTTP `/rpc` + `/ws`) and the
 *   real `createWebApp` BFF, every listener on loopback port 0;
 * - a real browser-shaped client over HTTP, the BFF `/ws` bridge and multipart
 *   upload — Node built-ins only (no Playwright, no browser download, no new
 *   dependency, no `fetch`);
 * - the product's own TypeScript sources loaded through Node's native type
 *   stripping plus a module-resolution hook (`scripts/lib/e2e-runtime.mjs`), so the
 *   drill exercises the same code `pnpm typecheck`, `pnpm lint` and `pnpm test:unit`
 *   see, never a stale `dist/`.
 *
 * It is deterministic and offline: no model is called. The provider the product
 * expects is a real-config-provider pointed at a loopback stub server that answers
 * 501 and counts every request, so "no model call happened" is an asserted fact,
 * not a promise.
 *
 * Checks run in order and the runner stops at the **first failure**, printing the
 * raw evidence. On success it prints the counts and writes
 * `.agentdev/work/WP-10/e2e-results.json` (the drill report `pnpm test:acceptance`
 * merges) and `.agentdev/work/WP-10/e2e.md` (the WP record).
 *
 * Usage: node scripts/e2e.mjs [--no-write] [--keep-temp] [--drill-out <path>] [--help]
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { computeBinding } from './lib/acceptance-binding.mjs';
import {
  E2E_BROWSER_ISOLATION_ACS,
  E2E_BROWSER_UPLOAD_ACS,
  E2E_BROWSER_VIEWPORT_ACS,
  E2E_PROVIDER_ACS,
} from './lib/drill-acs.mjs';
import { CheckFailure, CheckList, drillReport, renderE2eRecord } from './lib/e2e-checks.mjs';
import {
  REPO_ROOT,
  WsClient,
  cleanupTempDirs,
  cookiePair,
  git,
  httpRequest,
  jsonOf,
  loadProduct,
  makeTempDir,
  multipartBody,
  revisionOf,
  writeFileAt,
} from './lib/e2e-runtime.mjs';

/** The exact `Origin` both the daemon and the BFF allow (`protocol.md` §2). */
const WEB_ORIGIN = 'http://127.0.0.1:4317';
const REPORT_DIR = join(REPO_ROOT, '.agentdev', 'work', 'WP-10');
const DELIVERY_REF = 'refs/heads/agentdev/main';
const DOCUMENT_ROOT = 'docs/agentdev';
const FEATURE_ID = 'F-0a1b2c3d';
const OTHER_FEATURE_ID = 'F-0f0f0f0f';
const FEATURE_PATH = `${DOCUMENT_ROOT}/features/${FEATURE_ID}/README.md`;
const OTHER_FEATURE_PATH = `${DOCUMENT_ROOT}/features/${OTHER_FEATURE_ID}/README.md`;
const CODE_PATH = 'src/orders/cancel.ts';
const CODE_PATH_V2 = 'tests/orders/cancel.test.ts';

// ---------------------------------------------------------------------------
// Small assertion helpers (raw evidence, never a silent skip)
// ---------------------------------------------------------------------------

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function usage() {
  return [
    'Usage: node scripts/e2e.mjs [options]',
    '',
    '  --no-write        print the checks only; do not write the WP-10 reports',
    '  --keep-temp       keep the temporary project/state directories for forensics',
    '  --drill-out <p>   write the drill JSON to <p> instead of the WP-10 records',
    '                    (used by scripts/acceptance.mjs, which runs this drill itself)',
    '  --help            show this help',
    '',
    'Environment: none. The drill is offline by design; the real Provider drill is',
    '`pnpm test:live` with AGENTDEV_PROVIDER_BASE_URL/MODEL/SECRET.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { write: true, keepTemp: false, drillOut: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-write') options.write = false;
    else if (arg === '--keep-temp') options.keepTemp = true;
    else if (arg === '--drill-out') {
      index += 1;
      if (index >= argv.length) throw new Error('--drill-out requires a path');
      options.drillOut = argv[index];
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

// ---------------------------------------------------------------------------
// Knowledge documents (the product's own Feature document format)
// ---------------------------------------------------------------------------

/** A valid Feature document (`context.md` §2) for the temporary project. */
function featureMarkdown(input) {
  return [
    `# ${input.name}`,
    '',
    '| 字段 | 值 |',
    '|---|---|',
    `| feature_id | ${input.featureId} |`,
    `| name | ${input.name} |`,
    '| module | orders |',
    `| owner_document | ${input.path} |`,
    '| design | unconfirmed |',
    '| design_decision_refs | 无 |',
    `| implementation | ${input.implementation ?? 'partial'} |`,
    `| verification | ${input.verification ?? 'unverified'} |`,
    `| verification_evidence_refs | ${input.verificationEvidenceRefs ?? '无'} |`,
    `| verification_coverage | ${input.verificationCoverage ?? '无'} |`,
    '| investigation | investigated |',
    '| investigation_scope | 订单取消路由与状态转换 |',
    `| source_refs | git:${input.revision}:${CODE_PATH} |`,
    `| revision | ${input.revision} |`,
    '',
    '## 用途',
    '',
    `${input.name}的能力说明。`,
    '',
    '## 当前行为',
    '',
    input.behaviour,
    '',
    '## 关系',
    '',
    input.relations ?? '无',
    '',
    '## 实现入口',
    '',
    ...input.entries.map((entry) => `- ${entry}`),
    '',
    '## 已知差距',
    '',
    ...(input.gaps === undefined ? ['无已登记差距。'] : input.gaps.map((gap) => `- ${gap}`)),
    '',
    '## 关键决定',
    '',
    `- 按需求确认的行为处理（seed ${input.decisionRef}）。`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The drill
// ---------------------------------------------------------------------------

async function main(options) {
  const product = await loadProduct();

  const checks = new CheckList();
  const meta = {
    repoRoot: REPO_ROOT,
    gitHead: revisionOf(REPO_ROOT) || 'unavailable',
    binding: computeBinding(REPO_ROOT),
    providerConfigured: false,
    exitCode: 1,
    residuals: [
      '真实浏览器未执行（焦点遍历、像素级布局、脚本隔离攻击样例）：产品决定不引入 Playwright 或浏览器下载；浏览器级 AC-002/AC-052/AC-071/AC-073/AC-076 在演练报告中标为 UNVERIFIED。',
      '真实 Provider 未执行：本演练断言 Provider 桩零调用；AC-001/AC-043/AC-066 的真实模型纵向演练归 `pnpm test:live`（本环境未配置 AGENTDEV_PROVIDER_*）。',
      '需求→Work 绑定：产品当前没有“把已保存 Requirement 绑定到 Work”的协议方法（WP-06 车道），演练按 WP-06/WP-08 集成测试的既有做法直接更新真实 row 的 workId/requirementId。',
      'L2 链的 Task 行由演练直接插入（产品当前没有 Task 创建服务）；Plan 审批、StageGate 阶段结果、Git 候选提交、结算 CAS、知识补丁与冷启动均为真实服务。',
      'CAS journal 使用 @agentdev/workspace 的内存实现（createMemoryCasJournal），SQLite operation 表由 ProjectStore 承担；崩溃/恢复注入演练不在本切片范围。',
      '文件预览读取的是工作树字节，revision/branch 是 Project row 的标签（产品现状，NodeFilePort 即如此）；AC-077 的该行为按产品契约验证，未额外声称 Git 对象读取。',
      '观察（未修复，属 WP-06/WP-09 车道）：通过协议对已保存需求做“不含正文的元数据更新”时，提交的 content.md 会再写一次 `<!-- record-version: n -->` 标记（旧标记仍在正文里），因此 contentHash 变化。版本配对与组合 recordHash 仍有效（解析取首个标记），但正文会随每次元数据更新累积标记。演练把该观察写入证据而非断言其不存在。',
    ],
  };
  let harness;

  try {
    harness = await bootStack({ product, meta });
    await runChecks({ checks, harness, product });
    meta.exitCode = 0;
  } catch (error) {
    if (!(error instanceof CheckFailure)) throw error;
  } finally {
    if (harness !== undefined) await harness.close();
    if (!options.keepTemp) cleanupTempDirs();
    else process.stdout.write(`e2e: keeping temporary directories: ${harness?.roots.join(', ')}\n`);
  }

  const report = drillReport(checks, {
    repoRoot: REPO_ROOT,
    gitHead: meta.gitHead,
    binding: meta.binding,
    nonce: process.env.AGENTDEV_DRILL_NONCE ?? null,
    providerConfigured: false,
    exitCode: meta.exitCode,
  });

  if (options.drillOut !== null) {
    // In-run evidence for scripts/acceptance.mjs: the JSON goes to the nonce path the
    // aggregator created and the WP-10 records stay untouched.
    mkdirSync(dirname(options.drillOut), { recursive: true });
    writeFileSync(options.drillOut, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`e2e: wrote drill report to ${options.drillOut}\n`);
  } else if (options.write) {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(join(REPORT_DIR, 'e2e-results.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(REPORT_DIR, 'e2e.md'), renderE2eRecord(checks, meta));
    process.stdout.write(
      `e2e: wrote .agentdev/work/WP-10/e2e-results.json and .agentdev/work/WP-10/e2e.md\n`,
    );
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  process.stdout.write(
    `\ne2e: ${String(checks.records.length)} checks — PASS ${String(checks.passed)} / FAIL ${String(checks.failed)} / UNVERIFIED ${String(checks.unverifiedCount)}\n`,
  );
  process.stdout.write(
    `e2e: ${String(report.results.length)} ACs accounted for by the drill; exit ${String(meta.exitCode)}\n`,
  );
  if (checks.failure !== null) {
    process.stderr.write(
      `e2e: FAILED at ${checks.failure.name}\n${String(checks.failure.raw ?? checks.failure.evidence)}\n`,
    );
  }
  return meta.exitCode;
}

// ---------------------------------------------------------------------------
// Boot: the real stack over a real temporary project
// ---------------------------------------------------------------------------

async function bootStack({ product, meta }) {
  const {
    core,
    storage,
    workspace,
    knowledge,
    daemon: daemonModule,
    daemonProtocol,
    web: webModule,
  } = product;

  const repo = makeTempDir('agentdev-e2e-repo-');
  const dataDir = makeTempDir('agentdev-e2e-state-');
  const stateDir = makeTempDir('agentdev-e2e-auth-');

  const gitPort = workspace.createNodeWorktreeGitPort();
  const unwrap = (result, what) => {
    if (!result.ok) throw new Error(`${what}: ${result.errors[0]?.message ?? 'git failed'}`);
    return result.value;
  };

  // 1. A real Git project: knowledge documents and code committed together on the
  //    Product's delivery branch.
  writeFileAt(repo, CODE_PATH, 'export const cancel = (): boolean => false;\n');
  writeFileAt(repo, CODE_PATH_V2, "import { cancel } from '../../src/orders/cancel';\n");
  writeFileAt(
    repo,
    FEATURE_PATH,
    featureMarkdown({
      featureId: FEATURE_ID,
      name: '订单取消',
      path: FEATURE_PATH,
      revision: '0'.repeat(40),
      behaviour: '未付款订单不可取消。',
      entries: [CODE_PATH],
      decisionRef: 'decision:e2e-seed',
    }),
  );
  writeFileAt(
    repo,
    OTHER_FEATURE_PATH,
    featureMarkdown({
      featureId: OTHER_FEATURE_ID,
      name: '支付状态',
      path: OTHER_FEATURE_PATH,
      revision: '0'.repeat(40),
      behaviour: '付款状态决定可取消范围。',
      entries: ['src/payments/status.ts'],
      decisionRef: 'decision:e2e-seed',
    }),
  );
  unwrap(gitPort.initRepository(repo, { branch: 'agentdev/main' }), 'git init');
  writeFileAt(repo, '.gitignore', 'node_modules/\n.agentdev/work/\n');
  const seed = unwrap(
    gitPort.commitPaths(repo, 'chore: seed the e2e delivery branch', [
      CODE_PATH,
      CODE_PATH_V2,
      FEATURE_PATH,
      OTHER_FEATURE_PATH,
      '.gitignore',
    ]),
    'seed commit',
  );
  const seedRevision = seed.revision;

  // 2. The real Project database and the real Core services.
  const store = storage.ProjectStore.open({
    dataDir,
    canonicalRoot: repo,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    repository: { now: () => new Date().toISOString() },
  });
  const projectId = storage.projectIdFromRoot(repo);
  const blobs = new storage.BlobStore({ root: dataDir });

  // The auth clock is injectable so "expired cookie" is a deterministic fact, not
  // a sleep. Every other clock stays real.
  let authClockMs = Date.now();
  const auth = core.AuthService.loadOrCreate({
    stateDir,
    config: {
      deployment: 'loopback',
      allowedOrigins: [WEB_ORIGIN],
      sessionTtlMs: 60 * 60 * 1000,
      now: () => authClockMs,
    },
  });
  const installationToken = auth.createdToken ?? '';
  if (installationToken === '') throw new Error('the auth service created no installation token');

  const attachments = new core.AttachmentService({ store, blobs });
  const artifacts = new core.ArtifactService({ store, blobs });
  const tokens = new core.DownloadTokenStore();
  const events = new core.EventHub({ store });

  // The offline Provider stub: a real provider entry pointing at a loopback server
  // that records every request and refuses. No model call may reach it.
  const providerCalls = [];
  const providerStub = createServer((request, response) => {
    providerCalls.push(`${request.method ?? 'GET'} ${request.url ?? '/'}`);
    response.writeHead(501, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'the e2e provider stub never answers a model call' }));
  });
  await new Promise((resolve) => providerStub.listen(0, '127.0.0.1', resolve));
  const providerAddress = providerStub.address();
  const providerBaseUrl = `http://127.0.0.1:${String(typeof providerAddress === 'object' && providerAddress !== null ? providerAddress.port : 0)}/v1`;

  const config = core.ConfigStore.open({ globalDir: stateDir, projectRoot: dataDir });
  const provider = config.upsertProvider({
    type: 'openai-compatible',
    baseUrl: providerBaseUrl,
    enabled: true,
    models: [
      {
        id: 'e2e-offline-model',
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        reasoningLevels: ['off', 'low'],
        vision: false,
      },
    ],
  });
  config.update('global', {
    roleOverrides: {
      chief: {
        providerId: provider.providerId,
        modelId: 'e2e-offline-model',
        reasoning: 'off',
        skills: [],
        toolSubset: [],
        contextLimit: 32_000,
      },
    },
  });

  const gates = new core.PlanGateService({ store, artifacts, blobs });
  const findings = new core.FindingService({ store, artifacts });
  const decisions = new core.DecisionService({ store, artifacts });
  const requirements = new core.RequirementContinuation({ store });
  const journal = workspace.createMemoryCasJournal();
  const casEvents = workspace.createMemoryCasEvents();
  const cas = workspace.createCasService({ git: gitPort, journal, events: casEvents });
  const snapshots = new core.SnapshotWriter({ store });
  const lock = new core.ProjectIntegrationLock({ projectId, leases: store.leases });
  const settlement = new core.SettlementService({
    store,
    worktrees: gitPort,
    cas,
    journal,
    events: casEvents,
    snapshots,
  });
  const requirementSaves = core.createRequirementSaveService({
    store,
    worktrees: gitPort,
    journal,
    events: casEvents,
    cas,
    lock,
    worktreeRoot: join(dataDir, 'save-worktrees'),
    keepWorktree: false,
  });

  const protocol = new daemonProtocol.WorkbenchProtocol({
    store,
    blobs,
    events,
    attachments,
    artifacts,
    tokens,
    version: '0.0.0-e2e',
    config,
    gates,
    decisions,
    findings,
    requirements,
    requirementSaves,
  });

  store.projects.insert({
    id: projectId,
    root: repo,
    gitRoot: repo,
    codeRoot: 'src',
    documentRoot: DOCUMENT_ROOT,
    deliveryBranch: 'agentdev/main',
    trust: 'trusted',
    state: 'open',
    head: seedRevision,
  });
  const conversationId = store.newId();
  store.conversations.insert({
    id: conversationId,
    projectId,
    title: 'chief conversation',
    archived: false,
  });

  // 3. The real daemon (HTTP + WS) and the real BFF, both on loopback port 0.
  const daemonServer = daemonModule.createDaemon({
    projectId,
    store,
    blobs,
    auth,
    attachments,
    artifacts,
    tokens,
    version: '0.0.0-e2e',
    workbench: protocol,
  });
  await new Promise((resolve) => daemonServer.listen(0, '127.0.0.1', resolve));
  const daemonAddress = daemonServer.address();
  const daemonPort =
    typeof daemonAddress === 'object' && daemonAddress !== null ? daemonAddress.port : 0;
  const daemonUrl = `http://127.0.0.1:${String(daemonPort)}`;

  const app = webModule.createWebApp({
    daemon: { baseUrl: daemonUrl, origin: WEB_ORIGIN, bearer: installationToken },
    auth,
    allowedOrigins: [WEB_ORIGIN],
    sessions: new webModule.WebSessionStore(),
    files: new webModule.NodeFilePort(),
    version: '0.0.0-e2e',
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const webAddress = app.server.address();
  const webPort = typeof webAddress === 'object' && webAddress !== null ? webAddress.port : 0;
  const webUrl = `http://127.0.0.1:${String(webPort)}`;

  // 4. Publish the initial knowledge projection, so the Docs surface reads real rows.
  const initialDocuments = readFeatureDocuments(repo);
  const initialProjection = knowledge.buildProjection({
    documents: initialDocuments,
    revision: seedRevision,
    codeTreeRevision: seedRevision,
    knownIds: [],
    documentRoot: DOCUMENT_ROOT,
    cache: core.createSqliteProjectionCache({ store }),
  });
  if (!initialProjection.published) {
    throw new Error(
      `the seeded Feature documents are invalid: ${JSON.stringify(initialProjection.diagnostics)}`,
    );
  }

  Object.assign(meta, {
    projectRoot: repo,
    dataDir,
    daemonUrl,
    webUrl,
    webOrigin: WEB_ORIGIN,
    providerBaseUrl,
    seedRevision,
  });

  let cookie = '';
  let csrfToken = '';

  const harness = {
    product,
    repo,
    dataDir,
    stateDir,
    providerStub,
    seedRevision,
    store,
    blobs,
    auth,
    attachments,
    artifacts,
    tokens,
    events,
    config,
    providerId: provider.providerId,
    providerBaseUrl,
    gates,
    findings,
    decisions,
    requirements,
    requirementSaves,
    settlement,
    snapshots,
    gitPort,
    protocol,
    daemonServer,
    app,
    daemonUrl,
    webUrl,
    projectId,
    conversationId,
    installationToken,
    providerCalls,
    provider,
    advanceAuthClock(ms) {
      authClockMs += ms;
    },
    setSession(value) {
      cookie = value.cookie;
      csrfToken = value.csrfToken;
    },
    get cookie() {
      return cookie;
    },
    get csrfToken() {
      return csrfToken;
    },
    async close() {
      protocol.closeAll(1001, 'the e2e drill finished');
      await new Promise((resolve) => app.server.close(() => resolve()));
      await new Promise((resolve) => daemonServer.close(() => resolve()));
      await new Promise((resolve) => providerStub.close(() => resolve()));
      store.close();
    },
    roots: [repo, dataDir, stateDir],
  };

  // Real client helpers bound to the running stack.
  harness.login = async (token = installationToken, origin = WEB_ORIGIN) =>
    httpRequest(`${webUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ token }),
    });

  let requestSequence = 0;
  harness.rpc = async (method, params = {}, rpcOptions = {}) => {
    requestSequence += 1;
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      origin: rpcOptions.origin ?? WEB_ORIGIN,
    };
    if (rpcOptions.cookie !== null) headers.cookie = rpcOptions.cookie ?? cookie;
    if (rpcOptions.csrfToken !== null && (rpcOptions.csrfToken ?? csrfToken) !== '') {
      headers['x-csrf-token'] = rpcOptions.csrfToken ?? csrfToken;
    }
    const response = await httpRequest(`${webUrl}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: `e2e-${String(requestSequence)}`,
        method,
        projectId: rpcOptions.projectId ?? projectId,
        params,
        ...(rpcOptions.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: rpcOptions.idempotencyKey }),
        ...(rpcOptions.expectedVersion === undefined
          ? {}
          : { expectedVersion: rpcOptions.expectedVersion }),
      }),
    });
    return { status: response.status, headers: response.headers, frame: jsonOf(response) };
  };

  harness.accepted = async (method, params = {}, rpcOptions = {}) => {
    const answer = await harness.rpc(method, params, rpcOptions);
    ensure(
      answer.frame.ok === true,
      `${method} was refused with ${String(answer.frame.error?.code)}: ${String(answer.frame.error?.message)}`,
    );
    return answer.frame.result ?? {};
  };

  harness.page = async (path, pageOptions = {}) => {
    const headers = { accept: 'text/html' };
    if (pageOptions.cookie !== null) headers.cookie = pageOptions.cookie ?? cookie;
    const response = await httpRequest(`${webUrl}${path}`, { headers });
    return { status: response.status, html: response.text };
  };

  return harness;
}

/** Reads the two seeded Feature documents at `HEAD` (no commit has happened yet). */
function readFeatureDocuments(repo) {
  const read = (path) => ({
    relativePath: path,
    markdown: git(['show', `HEAD:${path}`], repo),
  });
  return [read(FEATURE_PATH), read(OTHER_FEATURE_PATH)];
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

async function runChecks({ checks, harness, product }) {
  const { core, storage, knowledge, domain } = product;
  const { store, gitPort } = harness;
  const unwrap = (result, what) => {
    if (!result.ok) throw new Error(`${what}: ${result.errors[0]?.message ?? 'git failed'}`);
    return result.value;
  };
  const uuidOf = (seed) => {
    const hex = storage.sha256(seed);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };

  // ---- C1: HTTP surface, session cookie and Origin -------------------------

  await checks.check('stack.boot', ['AC-078'], async () => {
    const daemonHealth = await httpRequest(`${harness.daemonUrl}/healthz`);
    const webHealth = await httpRequest(`${harness.webUrl}/healthz`);
    ensure(daemonHealth.status === 200, `daemon /healthz answered ${String(daemonHealth.status)}`);
    ensure(webHealth.status === 200, `BFF /healthz answered ${String(webHealth.status)}`);

    const anonymous = await harness.page('/', { cookie: null });
    ensure(anonymous.status === 401, `anonymous page answered ${String(anonymous.status)}`);
    ensure(anonymous.html.includes('id="loginForm"'), 'the anonymous page is not the sign-in page');

    const noCookie = await harness.rpc('project.snapshot.get', {}, { cookie: null });
    ensure(noCookie.status === 401, `unauthenticated /rpc answered ${String(noCookie.status)}`);
    ensure(noCookie.frame.error?.code === 'UNAUTHENTICATED', 'unauthenticated /rpc did not refuse');

    const badOrigin = await harness.login(harness.installationToken, 'http://evil.example.test');
    ensure(badOrigin.status === 403, `a foreign Origin login answered ${String(badOrigin.status)}`);
    ensure(
      jsonOf(badOrigin).error?.code === 'NOT_AUTHORIZED',
      'a foreign Origin login was not refused with NOT_AUTHORIZED',
    );

    const badToken = await harness.login('not-the-installation-token');
    ensure(badToken.status === 401, `a wrong token answered ${String(badToken.status)}`);

    const login = await harness.login();
    const cookie = cookiePair(login, 'agentdev_web');
    ensure(login.status === 200, `login answered ${String(login.status)}`);
    ensure(cookie !== undefined, 'login returned no agentdev_web cookie');
    const body = jsonOf(login);
    ensure(
      typeof body.csrfToken === 'string' && body.csrfToken !== '',
      'login returned no csrf token',
    );
    harness.setSession({ cookie, csrfToken: body.csrfToken });

    // A same-Origin write and a read both answer through the real daemon session.
    const snapshot = await harness.accepted('project.snapshot.get');
    ensure(snapshot.projectId === harness.projectId, 'the snapshot names another Project');

    return `daemon ${String(daemonHealth.status)}/BFF ${String(webHealth.status)} healthz; anonymous page 401; /rpc without cookie 401 UNAUTHENTICATED; wrong Origin login 403 NOT_AUTHORIZED; wrong token 401; login 200 with agentdev_web cookie (HttpOnly) + csrfToken; snapshot projectId=${harness.projectId}`;
  });

  await checks.check('auth.lifecycle', ['AC-078'], async () => {
    const wrongOrigin = await harness.rpc(
      'conversation.message.send',
      { conversationId: harness.conversationId, body: 'foreign origin write', attachmentIds: [] },
      { origin: 'http://evil.example.test', idempotencyKey: 'e2e-foreign-origin' },
    );
    ensure(
      wrongOrigin.status === 403,
      `a foreign-Origin write answered ${String(wrongOrigin.status)}`,
    );

    const logout = await httpRequest(`${harness.webUrl}/auth/logout`, {
      method: 'POST',
      headers: { origin: WEB_ORIGIN, cookie: harness.cookie },
    });
    ensure(logout.status === 200, `logout answered ${String(logout.status)}`);
    const afterLogout = await harness.rpc('project.snapshot.get');
    ensure(
      afterLogout.status === 401,
      `a logged-out cookie answered ${String(afterLogout.status)}`,
    );

    // A valid session expiring on the daemon side must clear the browser cookie
    // instead of retrying forever, and must not disturb background Work.
    const work = seedWork(harness, { level: 'L2', status: 'running', goal: 'survive the logout' });
    const relogin = await harness.login();
    harness.setSession({
      cookie: cookiePair(relogin, 'agentdev_web'),
      csrfToken: jsonOf(relogin).csrfToken,
    });
    const before = await harness.page(`/projects/${harness.projectId}/chief`);
    ensure(before.status === 200, 'the fresh session could not read the Chief page');

    harness.advanceAuthClock(2 * 60 * 60 * 1000);
    const expired = await harness.rpc('project.snapshot.get');
    ensure(
      expired.status === 401,
      `an expired daemon session answered ${String(expired.status)} instead of 401`,
    );
    const clearing = expired.headers['set-cookie'];
    const clearingHeader = Array.isArray(clearing) ? clearing.join(';') : String(clearing ?? '');
    ensure(
      clearingHeader.includes('agentdev_web=;') || clearingHeader.includes('agentdev_web="";'),
      `the expired cookie was not cleared: ${clearingHeader}`,
    );
    const stale = await httpRequest(`${harness.webUrl}/api/session`, {
      headers: { accept: 'application/json', cookie: harness.cookie },
    });
    ensure(
      stale.status === 401,
      `the expired browser session still answers ${String(stale.status)}`,
    );
    const listed = store.works.find(work.id);
    ensure(
      listed?.status === 'running',
      `the background Work changed state on session expiry (${String(listed?.status)})`,
    );

    const again = await harness.login();
    harness.setSession({
      cookie: cookiePair(again, 'agentdev_web'),
      csrfToken: jsonOf(again).csrfToken,
    });
    const resumed = await harness.page(`/projects/${harness.projectId}/chief`);
    ensure(resumed.status === 200, 'a re-login did not restore the workbench');
    return `foreign-Origin write 403; logout 200 then cookie 401; daemon session expired (+2h) -> /rpc 401 with the cookie cleared, /api/session 401, Work ${work.id} still running; re-login restored the Chief page`;
  });

  // ---- C2: requirement save (real Git commit + projection) ------------------

  const requirementState = {};
  await checks.check('requirement.save-git', ['AC-090', 'AC-093'], async () => {
    const saved = await harness.accepted(
      'requirement.save',
      {
        patch: {
          title: '未付款订单可取消',
          goal: '让未付款订单可取消并且已付款订单保留拒绝结果',
          scope: {
            readPaths: ['src'],
            writePaths: ['src'],
            operations: ['read', 'edit'],
            networkTargets: [],
          },
          lifecycle: 'active',
          acceptance: [
            {
              id: 'AC-010',
              given: '未付款订单',
              when: '用户取消',
              then: '订单被取消',
            },
          ],
          openQuestions: [],
          confirmedDecisions: [],
          relatedRequirementIds: [],
          contentMarkdown: [
            '# 未付款订单可取消',
            '',
            '## 目标与背景',
            '',
            '让未付款订单可以取消。',
            '',
            '## 范围与行为',
            '',
            '仅订单模块；已付款订单保留拒绝结果。',
            '',
            '## 验收说明',
            '',
            'AC-010。',
            '',
            '## 已确认决定',
            '',
            '无。',
            '',
            '## 未决问题',
            '',
            '无。',
            '',
            '## 完成摘要',
            '',
            '待明确',
            '',
          ].join('\n'),
        },
      },
      { idempotencyKey: 'e2e-requirement-save' },
    );
    ensure(saved.status === 'applied', `requirement.save answered ${String(saved.status)}`);
    ensure(saved.saveState === 'saved', `requirement save state is ${String(saved.saveState)}`);
    const requirementId = saved.requirementId;
    const commit = saved.git?.commit;
    ensure(typeof requirementId === 'string' && requirementId !== '', 'no requirement id');
    ensure(
      typeof commit === 'string' && commit.length === 40,
      `no real Git commit: ${String(commit)}`,
    );

    // Git is the authority: the record exists at the committed revision.
    const recordPath = `.agentdev/requirements/${requirementId}`;
    const metadata = JSON.parse(
      git(['show', `${commit}:${recordPath}/requirement.json`], harness.repo),
    );
    const content = git(['show', `${commit}:${recordPath}/content.md`], harness.repo);
    ensure(metadata.id === requirementId, 'the committed requirement.json names another id');
    ensure(metadata.lifecycle === 'active', `committed lifecycle=${String(metadata.lifecycle)}`);
    ensure(
      typeof metadata.contentHash === 'string' && metadata.contentHash.length === 64,
      'the committed requirement.json carries no contentHash',
    );
    for (const heading of [
      '## 目标与背景',
      '## 范围与行为',
      '## 验收说明',
      '## 已确认决定',
      '## 未决问题',
      '## 完成摘要',
    ]) {
      ensure(content.includes(heading), `content.md is missing ${heading}`);
    }

    const branchTip = revisionOf(harness.repo, DELIVERY_REF);
    ensure(branchTip === commit, `the delivery branch is at ${branchTip}, not the saved commit`);
    const row = store.requirements.find(requirementId);
    ensure(row?.portableRef.revision === commit, 'the projection does not point at the commit');
    ensure(row?.recordVersion === saved.recordVersion, 'the projection recordVersion drifted');

    const board = await harness.accepted('board');
    const cards = Object.values(board.columns).flat();
    const card = cards.find((entry) => entry.identity === requirementId);
    ensure(card !== undefined, 'the saved Requirement has no board card with its own identity');
    ensure(
      card.requirementId === requirementId,
      'the board card identity is not the Requirement id',
    );

    // The Git/projection agreement the surface reports: the save is on the
    // delivery branch and explicitly unpushed.
    ensure(
      saved.git?.branch === 'agentdev/main',
      `the save named branch ${String(saved.git?.branch)}`,
    );
    ensure(saved.git?.unpushed === true, 'the save did not report the commit as unpushed');
    ensure(saved.git?.refUpdated === true, 'the save did not move the delivery ref');

    // A second save is an update: it increments the record version and changes the
    // combined record hash without touching the committed body it does not name.
    const updated = await harness.accepted(
      'requirement.save',
      {
        requirementId,
        patch: {
          lifecycle: 'active',
          openQuestions: ['已付款订单的退款时限待确认'],
        },
      },
      { idempotencyKey: 'e2e-requirement-update' },
    );
    ensure(
      updated.recordVersion === saved.recordVersion + 1,
      `an update did not bump recordVersion (${String(updated.recordVersion)})`,
    );
    ensure(updated.recordHash !== saved.recordHash, 'the combined record hash did not change');
    ensure(updated.git?.commit !== commit, 'the update reused the create commit');
    const updatedMetadata = JSON.parse(
      git(['show', `${updated.git.commit}:${recordPath}/requirement.json`], harness.repo),
    );
    ensure(
      updatedMetadata.openQuestions.includes('已付款订单的退款时限待确认'),
      'the update did not commit the new open question',
    );
    // The protocol promises a partial patch preserves the recorded body. The drill
    // also observes whether the re-emitted `record-version` marker changes the
    // committed bytes, and reports that as a finding instead of asserting it away.
    const createBody = git(['show', `${commit}:${recordPath}/content.md`], harness.repo);
    const updateBody = git(
      ['show', `${updated.git.commit}:${recordPath}/content.md`],
      harness.repo,
    );
    ensure(updateBody.includes('# 未付款订单可取消'), 'the update lost the recorded body');
    ensure(updateBody.includes('## 完成摘要'), 'the update lost a required body section');
    ensure(updateBody.includes('待明确'), 'the update lost the recorded 完成摘要 placeholder');
    const bodyPreserved = createBody
      .split('\n')
      .filter((line) => line.trim() !== '')
      .every((line) => updateBody.includes(line));
    const contentHashChanged = updatedMetadata.contentHash !== metadata.contentHash;

    requirementState.id = requirementId;
    requirementState.commit = updated.git.commit;
    return `requirement ${requirementId} created at ${commit} (branch agentdev/main, unpushed, refUpdated) then updated to recordVersion ${String(updated.recordVersion)} at ${String(updated.git.commit).slice(0, 12)} with a changed recordHash; requirement.json+content.md committed atomically; board identity == requirement id; observation: partial update preserved every body line (${String(bodyPreserved)}) and re-emitted the record-version marker, contentHash ${contentHashChanged ? 'changed' : 'unchanged'}`;
  });

  // ---- C3: board rules (identity / L1 / Queued) -----------------------------

  await checks.check('board.rules', ['AC-068'], async () => {
    const queued = await harness.accepted(
      'requirement.save',
      {
        patch: {
          title: '稍后处理的排队需求',
          goal: '验证 Queued 无 Work 的看板规则',
          lifecycle: 'queued',
          scope: {
            readPaths: ['src'],
            writePaths: ['src'],
            operations: ['read', 'edit'],
            networkTargets: [],
          },
          acceptance: [],
          openQuestions: [],
          confirmedDecisions: [],
          relatedRequirementIds: [],
          contentMarkdown:
            '# 排队需求\n\n## 目标与背景\n\n待处理。\n\n## 范围与行为\n\n无。\n\n## 验收说明\n\n无。\n\n## 已确认决定\n\n无。\n\n## 未决问题\n\n无。\n\n## 完成摘要\n\n待明确\n',
        },
      },
      { idempotencyKey: 'e2e-requirement-queued' },
    );
    const queuedId = queued.requirementId;
    const l1 = seedWork(harness, {
      level: 'L1',
      status: 'running',
      goal: 'a read-only explanation',
    });

    const board = await harness.accepted('board');
    const cards = Object.values(board.columns).flat();
    ensure(
      (board.excludedWorkIds ?? []).includes(l1.id),
      'the L1 Work is not reported as excluded from the board',
    );
    ensure(board.rule?.l1NotOnBoard === true, 'the board does not declare the L1 rule');
    ensure(
      cards.some((entry) => entry.identity === queuedId && entry.canCancelWithoutWork === true),
      'the Queued requirement without Work is not directly cancellable',
    );
    ensure(
      cards.every((entry) => entry.work?.id !== l1.id),
      'an L1 Work became a board card',
    );

    const pause = await harness.rpc(
      'work.control',
      { action: 'pause', requirementId: queuedId, reason: 'ui' },
      { idempotencyKey: 'e2e-pause-queued' },
    );
    ensure(pause.status === 409, `pausing a Queued requirement answered ${String(pause.status)}`);
    ensure(
      pause.frame.error?.code === 'INVALID_STATE',
      `pausing a Queued requirement answered ${String(pause.frame.error?.code)}`,
    );

    const cancelled = await harness.accepted(
      'work.control',
      { action: 'cancel', requirementId: queuedId, reason: '用户取消（e2e）' },
      { idempotencyKey: 'e2e-cancel-queued' },
    );
    ensure(
      cancelled.lifecycle === 'cancelled',
      `cancel answered lifecycle ${String(cancelled.lifecycle)}`,
    );
    ensure(typeof cancelled.git?.commit === 'string', 'the Queued cancel wrote no Git record');
    const cancelTip = revisionOf(harness.repo, DELIVERY_REF);
    ensure(cancelTip === cancelled.git.commit, 'the cancel moved the branch to another revision');
    const cancelledRow = store.requirements.find(queuedId);
    ensure(cancelledRow?.lifecycle === 'cancelled', 'the projection still shows the old lifecycle');

    const page = await harness.page(`/projects/${harness.projectId}/requirements`);
    ensure(
      page.html.includes(`data-excluded="${l1.id}"`),
      'the board page does not list the exclusion',
    );
    ensure(
      page.html.includes(`data-identity="${queuedId}"`),
      'the board page lost the cancelled requirement identity',
    );
    return `board identity shared (${queuedId}); L1 Work ${l1.id} excluded and never a card; Queued pause -> 409 INVALID_STATE; Queued cancel -> cancelled at ${String(cancelled.git.commit)}; branch tip moved`;
  });

  // ---- C4: a conversation message routed by the Chief ----------------------

  const routingState = {};
  await checks.check('chief.routes-message', ['AC-069'], async () => {
    const before = store.events.latestCursor();
    const sent = await harness.accepted(
      'conversation.message.send',
      {
        conversationId: harness.conversationId,
        body: '请修改 src/orders/cancel.ts',
        attachmentIds: [],
      },
      { idempotencyKey: 'e2e-chief-route' },
    );
    const workId = sent.workId;
    ensure(typeof workId === 'string' && workId !== '', 'the message created no Work');
    ensure(store.events.latestCursor() > before, 'the message emitted no event');

    const assessment = store.assessments
      .list({ where: 'work_id = ?', params: [workId], orderBy: 'created_at ASC' })
      .at(-1);
    ensure(
      assessment !== undefined,
      `no assessment for Work ${workId}; workIds=${JSON.stringify(sent.workIds)} authorization=${String(sent.authorizationId)}`,
    );
    ensure(assessment?.intent === 'delivery', `assessment intent=${String(assessment?.intent)}`);
    ensure(assessment?.level === 'L2', `assessment level=${String(assessment?.level)}`);
    ensure(
      typeof assessment?.authorizationRef === 'string',
      'the routed Work carries no authorization',
    );
    const work = store.works.find(workId);
    ensure(work?.sourceRef.kind === 'message', 'the Work is not sourced from the message');
    ensure(work?.sourceRef.id === sent.messageId, 'the Work names another source message');

    const state = await harness.accepted('project.snapshot.get');
    ensure(state.counts.works >= 1, 'the snapshot reports no Work');

    const chief = await harness.page(`/projects/${harness.projectId}/chief`);
    ensure(
      chief.html.includes(`data-conversation="${harness.conversationId}"`),
      'the Chief page lost its conversation',
    );
    ensure(
      chief.html.includes('id="composerSend"'),
      'the Chief page lost its composer send control',
    );

    routingState.workId = workId;
    routingState.authorizationId = sent.authorizationId;
    routingState.assessment = assessment;
    return `message ${sent.messageId} routed to Work ${workId} (intent=${String(assessment?.intent)} level=${String(assessment?.level)} authorization=${String(sent.authorizationId)}); Work.sourceRef is the message; message.received emitted`;
  });

  // ---- C5: plan approval with a real Plan and the expired-card refusal ------

  const planState = {};
  await checks.check('plan.approval-expired-card', ['AC-070'], async () => {
    const workId = routingState.workId;
    const work = store.works.find(workId);
    const revision = work.baseRevision;

    const noPlan = await harness.accepted('plan.current', { workId });
    ensure(
      noPlan.currentVersion === 0,
      `a fresh Work reports plan version ${String(noPlan.currentVersion)}`,
    );
    ensure(noPlan.approval?.enabled === false, 'a fresh Work offers an approvable Plan');
    ensure(
      noPlan.approval?.reasonCode === 'no_plan',
      `reasonCode=${String(noPlan.approval?.reasonCode)}`,
    );

    // The Planning Run's own record; the gate re-reads it as the Plan's producer.
    const planningRun = store.runs.insert({
      id: store.newId(),
      projectId: harness.projectId,
      workId,
      role: 'planning',
      purpose: 'analysis',
      stage: 'Plan',
      status: 'completed',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: storage.sha256('config:planning'),
      contextSnapshotId: storage.sha256('context:planning'),
      dispatchSnapshotId: storage.sha256('dispatch:planning'),
      budgetAllocation: 10_000,
    });

    const planDraft = {
      goal: '让未付款订单可以取消',
      scope: {
        readPaths: [CODE_PATH],
        writePaths: [CODE_PATH],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      tasks: [
        {
          id: uuidOf('e2e-task-1'),
          role: 'backend',
          goal: '实现未付款订单取消，并保留已付款拒绝结果',
          paths: [CODE_PATH, CODE_PATH_V2],
          dependsOn: [],
          acceptanceIds: ['AC-010'],
          checks: ['pnpm test:unit'],
        },
      ],
      interfaceChanges: [],
      dataChanges: [],
      risks: [],
      rollback: ['revert the candidate commit'],
    };
    const approved = await harness.accepted(
      'plan.approve',
      {
        workId,
        revision,
        planVersion: 0,
        plan: planDraft,
        approval: {
          authorizationRef: routingState.authorizationId,
          runId: planningRun.id,
          productChanged: false,
        },
      },
      { idempotencyKey: 'e2e-plan-approve', expectedVersion: 0 },
    );
    ensure(approved.status === 'applied', `plan.approve answered ${String(approved.status)}`);
    const planVersion = approved.version;
    ensure(typeof planVersion === 'number' && planVersion > 0, 'the approved Plan has no version');

    const current = await harness.accepted('plan.current', { workId, planVersion });
    ensure(current.current === true, 'the approved Plan is not the current one');
    ensure(
      current.approval?.enabled === true,
      `approval disabled: ${String(current.approval?.reason)}`,
    );
    ensure(
      current.authorizationId === routingState.authorizationId,
      'the card names another authorization',
    );
    ensure(current.runId === planningRun.id, 'the card names another Planning Run');
    ensure(
      Array.isArray(current.plan?.tasks) && current.plan.tasks.length > 0,
      'the card has no Plan body',
    );

    // A superseded version can never be approved, and the card renders as expired.
    const statusBeforeRefusal = store.works.find(workId)?.status;
    const stale = await harness.rpc(
      'plan.approve',
      {
        workId,
        revision,
        planVersion: planVersion - 1,
        plan: planDraft,
        approval: { authorizationRef: routingState.authorizationId, runId: planningRun.id },
      },
      { idempotencyKey: 'e2e-plan-stale', expectedVersion: planVersion - 1 },
    );
    ensure(stale.frame.ok === false, 'a superseded Plan version was approved');
    ensure(
      stale.frame.error?.code === 'VERSION_CONFLICT',
      `a superseded Plan answered ${String(stale.frame.error?.code)}`,
    );
    ensure(
      stale.frame.error?.details?.currentVersion === planVersion,
      'the refusal did not report the live version',
    );
    ensure(
      store.works.find(workId)?.status === statusBeforeRefusal,
      'the refusal changed the Work state',
    );

    planState.version = planVersion;
    planState.planRef = approved.planRef;
    planState.planningRunId = planningRun.id;
    planState.revision = revision;
    return `no-plan refusal (enabled=false reasonCode=no_plan); plan.approve v${String(planVersion)} planRef=${approved.planRef.id}; plan.current enabled=true with ${String(current.plan.tasks.length)} task(s), authorization=${routingState.authorizationId}; superseded v${String(planVersion - 1)} -> VERSION_CONFLICT currentVersion=${String(planVersion)}`;
  });

  // ---- C6: Inbox decision de-duplication -----------------------------------

  await checks.check('inbox.decision-dedup', ['AC-074'], async () => {
    const workId = routingState.workId;
    const targetId = uuidOf('e2e-decision-target');
    const first = store.decisions.insert({
      id: store.newId(),
      projectId: harness.projectId,
      workId,
      kind: 'start',
      targetRef: { id: targetId, version: 4, hash: storage.sha256(`t:${targetId}`) },
      choices: ['now', 'later', 'decline'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    const duplicate = store.decisions.insert({
      id: store.newId(),
      projectId: harness.projectId,
      workId,
      kind: 'start',
      targetRef: { id: targetId, version: 4, hash: storage.sha256(`t:${targetId}`) },
      choices: ['now', 'later', 'decline'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    const expired = store.decisions.insert({
      id: store.newId(),
      projectId: harness.projectId,
      workId,
      kind: 'start',
      targetRef: { id: targetId, version: 5, hash: storage.sha256(`t:${targetId}`) },
      choices: ['now', 'later', 'decline'],
      state: 'expired',
      actor: 'user',
      effectRefs: [],
    });

    const inbox = await harness.accepted('inbox');
    const rows = (inbox.items ?? []).filter((item) => item.kind === 'decision');
    const sameTarget = rows.filter(
      (item) => item.targetRef?.id === targetId && item.targetRef?.version === 4,
    );
    ensure(
      sameTarget.length === 1,
      `the Inbox shows ${String(sameTarget.length)} rows for one target version`,
    );
    const expiredRows = rows.filter((item) => item.targetRef?.version === 5);
    ensure(expiredRows.length === 1, 'the expired decision is missing from the Inbox');
    ensure(expiredRows[0].actionable === false, 'an expired decision is still actionable');

    const refusedExpired = await harness.rpc(
      'decision.resolve',
      { decisionId: expired.id, targetVersion: 5, choice: 'now' },
      { idempotencyKey: 'e2e-decision-expired' },
    );
    ensure(refusedExpired.frame.ok === false, 'an expired decision was applied');
    ensure(
      refusedExpired.frame.error?.code === 'INVALID_STATE',
      `expired decision answered ${String(refusedExpired.frame.error?.code)}`,
    );

    const applied = await harness.accepted(
      'decision.resolve',
      { decisionId: first.id, targetVersion: 4, choice: 'now' },
      { idempotencyKey: 'e2e-decision-apply' },
    );
    ensure(applied.state === 'accepted', `resolve answered state=${String(applied.state)}`);
    const replayed = await harness.accepted(
      'decision.resolve',
      { decisionId: first.id, targetVersion: 4, choice: 'now' },
      { idempotencyKey: 'e2e-decision-replay' },
    );
    ensure(replayed.idempotent === true, 're-resolving the same choice was not idempotent');
    ensure(store.decisions.find(duplicate.id)?.state === 'pending', 'a duplicate row was resolved');

    const page = await harness.page(`/projects/${harness.projectId}/inbox`);
    ensure(
      page.html.includes(`data-decision="${first.id}"`),
      'the Inbox page lost the decision row',
    );
    ensure(page.html.includes('data-target-version="4"'), 'the Inbox page lost the target version');
    return `two same-target decisions collapsed to 1 Inbox row (ids ${first.id}/${duplicate.id}); expired row actionable=false; resolve -> accepted + idempotent replay; duplicate row untouched`;
  });

  // ---- C7: config validation preserves input -------------------------------

  await checks.check('config.validation-preserves-input', ['AC-075'], async () => {
    const before = await harness.accepted('config.get', { scope: 'global' });
    const revision = before.revision;

    const bad = await harness.rpc(
      'config.save',
      { scope: 'global', patch: { unknownKey: true } },
      { idempotencyKey: 'e2e-config-bad', expectedVersion: revision },
    );
    ensure(bad.frame.ok === false, 'an unknown config key was accepted');
    ensure(
      bad.frame.error?.code === 'VALIDATION_ERROR',
      `an unknown config key answered ${String(bad.frame.error?.code)}`,
    );
    ensure(
      JSON.stringify(bad.frame.error?.details?.preservedInput ?? {}).includes('unknownKey'),
      'the refusal did not hand the caller input back',
    );
    const after = await harness.accepted('config.get', { scope: 'global' });
    ensure(after.revision === revision, 'a rejected patch bumped the active config revision');

    // A structurally valid but unusable profile is reported by `config.test`, and
    // the active configuration stays what the operator last chose.
    const saved = await harness.accepted(
      'config.save',
      { scope: 'global', patch: { roleOverrides: { chief: { reasoning: 'high' } } } },
      { idempotencyKey: 'e2e-config-high', expectedVersion: revision },
    );
    ensure(saved.revision === revision + 1, 'the reasoning override was not saved');
    const unusable = await harness.rpc(
      'config.test',
      { role: 'chief' },
      { idempotencyKey: 'e2e-config-test' },
    );
    ensure(unusable.frame.ok === false, 'an unsupported reasoning profile was reported usable');
    ensure(
      unusable.frame.error?.code === 'PROVIDER_UNAVAILABLE',
      `config.test answered ${String(unusable.frame.error?.code)}`,
    );
    ensure(
      typeof unusable.frame.error?.message === 'string' &&
        unusable.frame.error.message.includes('does not support reasoning high'),
      `config.test gave no usable reason: ${String(unusable.frame.error?.message)}`,
    );
    ensure(
      JSON.stringify(unusable.frame.error?.details?.preservedInput ?? {}).includes('chief'),
      'config.test did not hand the checked input back',
    );

    const restored = await harness.accepted(
      'config.save',
      { scope: 'global', patch: { roleOverrides: { chief: { reasoning: 'off' } } } },
      { idempotencyKey: 'e2e-config-restore', expectedVersion: revision + 1 },
    );
    const usable = await harness.accepted('config.test', { role: 'chief' });
    ensure(
      usable.reasoning === 'off' && usable.reasoningSupported === true,
      'the restore did not take',
    );

    const page = await harness.page('/settings');
    ensure(
      page.html.includes(`data-revision="${String(restored.revision)}"`),
      'Settings shows a stale revision',
    );
    ensure(
      page.html.includes(`data-provider="${harness.providerId}"`),
      'Settings lost the provider row',
    );
    ensure(
      !page.html.includes(harness.installationToken),
      'Settings leaked the installation token',
    );
    return `unknownKey -> 422 VALIDATION_ERROR with preservedInput, revision unchanged at ${String(revision)}; reasoning=high saved (rev ${String(saved.revision)}) then config.test -> PROVIDER_UNAVAILABLE with preservedInput; restored to off (rev ${String(restored.revision)}), Settings revision matches`;
  });

  // ---- C8: attachment upload through the BFF + first-message binding -------

  await checks.check('attachment.upload-first-message', ['AC-084'], async () => {
    const multipart = multipartBody(
      { conversationId: harness.conversationId },
      { filename: 'notes.md', mime: 'text/markdown', bytes: Buffer.from('# notes\n', 'utf8') },
    );
    const uploaded = await httpRequest(`${harness.webUrl}/artifacts/upload`, {
      method: 'POST',
      headers: {
        origin: WEB_ORIGIN,
        cookie: harness.cookie,
        'x-csrf-token': harness.csrfToken,
        'content-type': multipart.contentType,
      },
      body: multipart.body,
    });
    ensure(
      uploaded.status === 201,
      `the BFF upload answered ${String(uploaded.status)}: ${uploaded.text.slice(0, 200)}`,
    );
    const attachment = jsonOf(uploaded);
    ensure(typeof attachment.attachmentId === 'string', 'the upload returned no attachment id');
    const staged = store.attachments.find(attachment.attachmentId);
    ensure(staged?.state === 'staged', `the upload state is ${String(staged?.state)}`);
    ensure(
      staged?.ownerUserId === core.userIdFromSubject('installation:local'),
      'the upload owner is not the installation user',
    );

    const messagesBefore = store.messages.count('conversation_id = ?', [harness.conversationId]);
    const sent = await harness.accepted(
      'conversation.message.send',
      {
        conversationId: harness.conversationId,
        body: '请阅读附件并据此修改',
        attachmentIds: [attachment.attachmentId],
      },
      { idempotencyKey: 'e2e-attachment-first' },
    );
    const workId = sent.workId;
    const bound = store.attachments.find(attachment.attachmentId);
    ensure(bound?.state === 'bound', `the attachment state is ${String(bound?.state)}`);
    ensure(bound?.workId === workId, 'the attachment is bound to another Work');
    ensure(bound?.boundMessageId === sent.messageId, 'the attachment is bound to another message');
    const userArtifacts = store.artifacts.list({ where: 'work_id = ?', params: [workId] });
    ensure(
      userArtifacts.length === 1,
      `expected exactly one user artifact, found ${String(userArtifacts.length)}`,
    );
    ensure(userArtifacts[0]?.origin === 'user', 'the bound artifact is not a user artifact');
    ensure(
      store.messages.count('conversation_id = ?', [harness.conversationId]) === messagesBefore + 1,
      'the message was not persisted',
    );
    const body = store.messageBodies.list({ orderBy: 'created_at DESC' })[0];
    ensure(body !== undefined, 'the message body was not stored');

    // A refused upload (unsupported mime) must leave no residual row.
    const beforeBad = store.attachments.count();
    const badUpload = multipartBody(
      { conversationId: harness.conversationId },
      { filename: 'x.zip', mime: 'application/zip', bytes: Buffer.from('MZ', 'utf8') },
    );
    const refused = await httpRequest(`${harness.webUrl}/artifacts/upload`, {
      method: 'POST',
      headers: {
        origin: WEB_ORIGIN,
        cookie: harness.cookie,
        'x-csrf-token': harness.csrfToken,
        'content-type': badUpload.contentType,
      },
      body: badUpload.body,
    });
    ensure(refused.status >= 400, `an unsupported mime was accepted (${String(refused.status)})`);
    ensure(store.attachments.count() === beforeBad, 'a refused upload left a row behind');

    // A duplicated bind is refused; the original binding is untouched.
    const reused = await harness.rpc(
      'conversation.message.send',
      {
        conversationId: harness.conversationId,
        body: '再来一次',
        attachmentIds: [attachment.attachmentId],
      },
      { idempotencyKey: 'e2e-attachment-reuse' },
    );
    ensure(reused.frame.ok === false, 'a bound attachment was bound twice');
    ensure(
      reused.frame.error?.code === 'ATTACHMENT_ALREADY_BOUND',
      `duplicate bind answered ${String(reused.frame.error?.code)}`,
    );
    return `upload 201 attachmentId=${attachment.attachmentId} (staged, installation owner); first message ${sent.messageId} bound it to Work ${workId} atomically with 1 user artifact; unsupported mime refused (${String(refused.status)}) with no residue; duplicate bind -> ATTACHMENT_ALREADY_BOUND`;
  });

  // ---- C9: branch preview boundaries ---------------------------------------

  await checks.check('files.branch-preview-boundaries', ['AC-077'], async () => {
    const head = store.projects.find(harness.projectId)?.head ?? '';
    const preview = await harness.page(
      `/projects/${harness.projectId}/files?path=${encodeURIComponent(CODE_PATH)}`,
    );
    ensure(preview.status === 200, `the Files page answered ${String(preview.status)}`);
    ensure(
      preview.html.includes(`data-revision="${head}"`),
      'the Files page shows another revision',
    );
    ensure(
      preview.html.includes('data-branch="agentdev/main"'),
      'the Files page shows another branch',
    );
    ensure(
      preview.html.includes('export const cancel'),
      'the Files page did not read the real file',
    );
    ensure(
      preview.html.includes('data-i18n="files.rootBoundary"'),
      'the root-boundary promise is missing',
    );

    const search = await harness.page(`/projects/${harness.projectId}/files?query=orders`);
    ensure(
      search.html.includes('src/orders/cancel.ts'),
      'the Files search did not find the real file',
    );

    const absolute = await harness.page(
      `/projects/${harness.projectId}/files?path=${encodeURIComponent('/etc/passwd')}`,
    );
    ensure(absolute.html.includes('data-code="NOT_FOUND"'), 'an absolute path was not refused');
    const traversal = await harness.page(
      `/projects/${harness.projectId}/files?path=${encodeURIComponent('../../etc/passwd')}`,
    );
    ensure(traversal.html.includes('data-code="NOT_FOUND"'), 'a traversal path was not refused');
    ensure(!traversal.html.includes('root:'), 'a traversal path leaked host content');

    // The read-only preview never touches what an Agent sees: no snapshot rows.
    const snapshotsBefore = store.snapshots.count();
    await harness.page(
      `/projects/${harness.projectId}/files?path=${encodeURIComponent(CODE_PATH)}`,
    );
    ensure(
      store.snapshots.count() === snapshotsBefore,
      'browsing files created a context snapshot',
    );

    // Advancing the branch label moves the reported target revision.
    writeFileAt(harness.repo, 'README.md', '# e2e project\n\nmoved\n');
    const advanced = unwrap(
      gitPort.commitPaths(harness.repo, 'chore: advance the delivery branch', ['README.md']),
      'advance commit',
    ).revision;
    const stale = await harness.page(`/projects/${harness.projectId}/files?path=README.md`);
    ensure(
      stale.html.includes(`data-revision="${head}"`),
      'the page did not keep the Project row revision',
    );
    store.projects.update(
      harness.projectId,
      { head: advanced },
      store.projects.find(harness.projectId)?.version ?? 1,
    );
    const moved = await harness.page(`/projects/${harness.projectId}/files?path=README.md`);
    ensure(
      moved.html.includes(`data-revision="${advanced}"`),
      'the page did not follow the Project head',
    );
    return `revision=${head.slice(0, 12)} branch=agentdev/main, real file content; search found src/orders/cancel.ts; absolute+traversal -> data-code=NOT_FOUND with no leak; snapshots unchanged (${String(snapshotsBefore)}); head advanced to ${advanced.slice(0, 12)} and the page followed`;
  });

  // ---- C10: the nine surfaces render real state ----------------------------

  await checks.check(
    'surfaces.nine-real-state',
    ['AC-068', 'AC-069', 'AC-072', 'AC-074', 'AC-075', 'AC-077', 'AC-038'],
    async () => {
      const projectId = harness.projectId;
      const requirementId = requirementState.id;
      const expected = [
        ['/projects', `data-project="${projectId}"`],
        [`/projects/${projectId}/chief`, `data-conversation="${harness.conversationId}"`],
        [`/projects/${projectId}/requirements`, 'data-column="queued"'],
        [
          `/projects/${projectId}/requirements/${requirementId}`,
          `data-requirement="${requirementId}"`,
        ],
        [`/projects/${projectId}/docs`, `data-feature="${FEATURE_ID}"`],
        [`/projects/${projectId}/files`, 'data-branch="agentdev/main"'],
        [`/projects/${projectId}/agents`, 'data-role="chief"'],
        [`/projects/${projectId}/runs`, 'data-work='],
        [`/projects/${projectId}/inbox`, 'data-target-version="4"'],
        ['/settings', 'data-scope="global"'],
      ];
      const seen = [];
      for (const [path, marker] of expected) {
        const page = await harness.page(path);
        ensure(page.status === 200, `${path} answered ${String(page.status)}`);
        ensure(page.html.includes(marker), `${path} did not render ${marker}`);
        seen.push(`${path} ok`);
      }
      // The Live panel's three documented modes are renderable state on every page.
      for (const mode of ['open', 'compact', 'hidden']) {
        const page = await harness.page(`/projects/${projectId}/chief`, {
          cookie: `${harness.cookie}; agentdev_panel=${mode}`,
        });
        ensure(
          page.html.includes(`data-panel-mode="${mode}"`),
          `the Live panel did not render ${mode}`,
        );
      }
      // Conversation ownership: only the Chief page may create or switch conversations.
      const nonChief = await harness.page(`/projects/${projectId}/requirements`);
      const chief = await harness.page(`/projects/${projectId}/chief`);
      ensure(chief.html.includes('id="newConversation"'), 'the Chief page lost the create control');
      ensure(
        !nonChief.html.includes('id="newConversation"'),
        'a non-Chief page offers the create control',
      );
      ensure(
        nonChief.html.includes('id="discussInChief"'),
        'a non-Chief page lost the Chief deep link',
      );
      // The three separated knowledge views are real protocol answers.
      const delivered = await harness.page(`/projects/${projectId}/docs?view=delivered`);
      const design = await harness.page(`/projects/${projectId}/docs?view=design`);
      const workView = await harness.page(`/projects/${projectId}/docs?view=work`);
      for (const [name, page] of [
        ['delivered', delivered],
        ['design', design],
        ['work', workView],
      ]) {
        ensure(page.status === 200, `the ${name} knowledge view answered ${String(page.status)}`);
        ensure(
          page.html.includes(`name="view" value="${name}"`),
          `the ${name} knowledge view did not render as the active view`,
        );
      }
      return `10 surfaces read real state (${seen.join('; ')}); Live panel modes open/compact/hidden; create/switch control only on the Chief page with the deep link elsewhere; docs delivered/design/work views all real answers`;
    },
  );

  // ---- C11: the event stream and its watermark after a reconnect -----------

  await checks.check('events.watermark-reconnect', ['AC-054', 'AC-060'], async () => {
    const socket = await WsClient.connect(`${harness.webUrl.replace('http', 'ws')}/ws`, {
      cookie: harness.cookie,
      origin: WEB_ORIGIN,
    });
    try {
      // The BFF bridge forwards responses/events/batch_end; the daemon's own
      // greeting is consumed by the bridge, so the browser negotiates explicitly.
      socket.send({
        v: 1,
        type: 'request',
        id: 'hello',
        method: 'connection.hello',
        params: { protocolVersion: 1, client: 'web' },
      });
      const hello = await socket.waitFor((frame) => frame.id === 'hello', {
        label: 'connection.hello',
      });
      ensure(hello.ok === true, `connection.hello failed: ${JSON.stringify(hello.error)}`);
      ensure(hello.result?.protocolVersion === 1, 'the hello negotiated another protocol version');

      socket.send({
        v: 1,
        type: 'request',
        id: 'sub',
        method: 'project.subscribe',
        projectId: harness.projectId,
        params: { scope: { kind: 'summary' } },
      });
      const subscribed = await socket.waitFor((frame) => frame.id === 'sub', {
        label: 'project.subscribe',
      });
      ensure(
        subscribed.ok === true,
        `project.subscribe failed: ${JSON.stringify(subscribed.error)}`,
      );
      const subscriptionId = subscribed.result?.subscriptionId;
      ensure(typeof subscriptionId === 'string', 'no subscription id');
      await socket.waitFor(
        (frame) => frame.type === 'batch_end' && frame.subscriptionId === subscriptionId,
        { label: 'the first batch_end watermark' },
      );

      await harness.accepted(
        'conversation.message.send',
        { conversationId: harness.conversationId, body: 'before the break', attachmentIds: [] },
        { idempotencyKey: 'e2e-events-before' },
      );
      const first = await socket.waitFor(
        (frame) => frame.type === 'event' && frame.name === 'message.received',
        { label: 'message.received' },
      );
      const watermark = Number(first.cursor ?? 0);
      ensure(watermark > 0, 'the first event has no cursor');
      socket.send({
        v: 1,
        type: 'request',
        id: 'ack',
        method: 'project.events.ack',
        params: { subscriptionId, cursor: watermark },
      });
      const ack = await socket.waitFor((frame) => frame.id === 'ack', {
        label: 'project.events.ack',
      });
      ensure(
        ack.ok === true && ack.result?.acknowledged === watermark,
        'the ack was not acknowledged',
      );

      // Drop the daemon side: the browser holds its acknowledged watermark while a
      // new event is produced, then the BFF resumes from that watermark.
      const workStatusBefore = store.works.find(routingState.workId)?.status;
      harness.protocol.closeAll(1001, 'network dropped');
      const reconnect = await socket.waitFor((frame) => frame.type === 'bridge.reconnecting', {
        label: 'bridge.reconnecting',
      });
      ensure(Number(reconnect.attempt) >= 1, 'the bridge did not report a reconnect attempt');
      ensure(
        store.works.find(routingState.workId)?.status === workStatusBefore,
        'the background Work changed state while the stream was down',
      );
      await harness.accepted(
        'conversation.message.send',
        { conversationId: harness.conversationId, body: 'during the break', attachmentIds: [] },
        { idempotencyKey: 'e2e-events-during' },
      );
      await socket.waitFor((frame) => frame.type === 'bridge.open', {
        label: 'bridge.open',
        timeoutMs: 20_000,
      });
      const replayed = await socket.waitFor(
        (frame) =>
          frame.type === 'event' &&
          frame.name === 'message.received' &&
          Number(frame.cursor ?? 0) > watermark,
        { label: 'the event produced during the break', timeoutMs: 20_000 },
      );
      ensure(Number(replayed.cursor) > watermark, 'the resumed stream replayed nothing new');
      const duplicated = socket.frames.filter(
        (frame) => frame.type === 'event' && Number(frame.cursor ?? 0) <= watermark,
      );
      ensure(
        duplicated.length === 1,
        `the resumed stream duplicated ${String(duplicated.length - 1)} event(s)`,
      );

      // A fresh connection resumes from the same watermark: snapshot + events after
      // the cursor, and nothing at or below it.
      const resumed = await WsClient.connect(`${harness.webUrl.replace('http', 'ws')}/ws`, {
        cookie: harness.cookie,
        origin: WEB_ORIGIN,
      });
      try {
        resumed.send({
          v: 1,
          type: 'request',
          id: 'hello2',
          method: 'connection.hello',
          params: { protocolVersion: 1, client: 'web' },
        });
        await resumed.waitFor((frame) => frame.id === 'hello2', { label: 'the resumed hello' });
        resumed.send({
          v: 1,
          type: 'request',
          id: 'sub2',
          method: 'project.subscribe',
          projectId: harness.projectId,
          params: { scope: { kind: 'summary' }, afterCursor: watermark },
        });
        const replay = await resumed.waitFor((frame) => frame.id === 'sub2', {
          label: 'the resumed subscribe',
        });
        ensure(replay.ok === true, `the resumed subscribe failed: ${JSON.stringify(replay.error)}`);
        ensure(
          replay.result?.mode === 'replay',
          `the resumed subscribe mode=${String(replay.result?.mode)}`,
        );
        await resumed.waitFor((frame) => frame.type === 'batch_end', {
          label: 'the replay batch_end',
        });
        const stale = resumed.frames.filter(
          (frame) => frame.type === 'event' && Number(frame.cursor ?? 0) <= watermark,
        );
        ensure(
          stale.length === 0,
          `the replay repeated ${String(stale.length)} acknowledged event(s)`,
        );
      } finally {
        resumed.close();
      }
      return `hello/subscribe over the BFF /ws; first cursor ${String(watermark)} acked; daemon dropped -> bridge.reconnecting -> bridge.open; the during-break event replayed above the watermark with no duplicate; a fresh socket resumed in mode=replay with nothing at or below ${String(watermark)}; Work stayed running`;
    } finally {
      socket.close();
    }
  });

  // ---- C12: the L2 delivery chain ------------------------------------------

  const chainState = {};
  await checks.check('delivery.l2-chain', ['AC-010'], async () => {
    const workId = routingState.workId;
    const requirementId = requirementState.id;

    // Bind the saved Requirement to the routed Work: the product has no protocol
    // method for this yet (WP-06 lane), so the drill sets the real row's link the
    // way the WP-06/WP-08 integration tests do.
    const requirementRow = store.requirements.find(requirementId);
    store.requirements.update(
      requirementId,
      { workId, lifecycle: 'active', phase: 'execute' },
      requirementRow.version,
    );
    const workRow = store.works.find(workId);
    store.works.update(workId, { requirementId }, workRow.version);

    const task = store.tasks.insert({
      id: store.newId(),
      workId,
      requirementId,
      planRef: planState.planRef,
      role: 'backend',
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: {
        readPaths: [CODE_PATH],
        writePaths: [CODE_PATH],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      stage: 'develop',
      acceptanceIds: ['AC-010'],
    });

    // A real detached worktree commit on the *current* delivery tip: the candidate
    // revision the delivery would install.
    const baseRevision = revisionOf(harness.repo, DELIVERY_REF);
    ensure(baseRevision !== '', 'the delivery branch has no revision to build on');
    const worktree = join(harness.dataDir, 'task-worktree');
    unwrap(
      gitPort.addWorktree({ repoRoot: harness.repo, path: worktree, baseRevision }),
      'git worktree add',
    );
    writeFileAt(worktree, CODE_PATH, 'export const cancel = (): boolean => true;\n');
    writeFileAt(worktree, CODE_PATH_V2, "import { cancel } from '../../src/orders/cancel';\n");
    const candidate = unwrap(
      gitPort.commitPaths(worktree, 'feat: make unpaid orders cancellable', [
        CODE_PATH,
        CODE_PATH_V2,
      ]),
      'candidate commit',
    ).revision;
    const codeTree = core.deliveredCodeTreeHash({ repoRoot: harness.repo, revision: candidate });
    const commitTree = unwrap(gitPort.mergeTree(harness.repo, candidate), 'merge tree');
    ensure(typeof codeTree === 'string' && codeTree.length === 64, 'no SHA256 code tree');
    ensure(typeof commitTree === 'string' && commitTree.length === 40, 'no Git tree OID');

    // The five L2 stages are real Runs whose Attempts submit real stage results
    // through the real `StageGate`.
    const stageGate = new core.StageGate({ store });
    const environmentRef = store.newId();
    const stages = [
      ['Plan', 'planning', 'artifact', undefined],
      ['Develop', 'backend', 'implementation', { changedPaths: [CODE_PATH, CODE_PATH_V2] }],
      ['Review', 'review', 'review', { changedPaths: [CODE_PATH] }],
      ['Test', 'test', 'test', { changedPaths: [CODE_PATH] }],
      ['Settlement', 'settlement', 'settlement', undefined],
    ];
    const stageResults = [];
    for (const [stage, role, purpose, extra] of stages) {
      const run = store.runs.insert({
        id: store.newId(),
        projectId: harness.projectId,
        workId,
        taskId: task.id,
        role,
        purpose,
        stage,
        status: 'running',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: storage.sha256(`config:${stage}`),
        contextSnapshotId: storage.sha256(`context:${stage}`),
        dispatchSnapshotId: storage.sha256(`dispatch:${stage}`),
        budgetAllocation: 5_000,
      });
      const attempt = store.attempts.insert({
        id: store.newId(),
        projectId: harness.projectId,
        runId: run.id,
        number: 1,
        status: 'running',
        ownerEpoch: 7,
        runnerId: 'e2e-runner',
      });
      const payload = {
        status: 'success',
        summary: `${stage} completed against ${candidate}`,
        artifactRefs: [],
        evidenceRefs: stage === 'Plan' ? [planState.planRef.id] : [],
        changedPaths: extra?.changedPaths ?? [],
        findingIds: [],
        unknowns: [],
        requestedActions: [],
        readLedgerSeq: 0,
        readLedgerHash: '0'.repeat(64),
        ...(stage === 'Test'
          ? {
              checkResult: {
                status: 'passed',
                checks: [
                  {
                    acceptanceIds: ['AC-010'],
                    command: 'pnpm test:unit',
                    exitCode: 0,
                    environmentRef,
                    inputTree: codeTree,
                    outputRef: store.newId(),
                    result: 'the unpaid-order cancellation suite passed',
                  },
                ],
                uncovered: [],
              },
            }
          : {}),
      };
      const submitted = stageGate.submit({
        runId: run.id,
        attemptId: attempt.id,
        epoch: 7,
        payload,
      });
      ensure(
        submitted.accepted === true,
        `${stage} stage.submit was refused: ${JSON.stringify(submitted)}`,
      );
      stageResults.push({ stage, run, attempt, row: submitted.row });
    }
    ensure(
      stageResults.every((entry) => entry.row.status === 'success'),
      'a stage result is not a success',
    );

    // The product's own L2 chain rule decides whether the five stages form a chain.
    const manifests = [
      { stage: 'Plan', workId, planRef: planState.planRef },
      {
        stage: 'Develop',
        workId,
        taskId: task.id,
        codeRevision: candidate,
        codeTree,
        dependsOn: ['Plan'],
      },
      {
        stage: 'Review',
        workId,
        taskId: task.id,
        codeRevision: candidate,
        codeTree,
        environmentRef,
        dependsOn: ['Develop'],
      },
      {
        stage: 'Test',
        workId,
        taskId: task.id,
        codeRevision: candidate,
        codeTree,
        environmentRef,
        dependsOn: ['Review'],
      },
      { stage: 'Settlement', workId, dependsOn: ['Test'] },
    ];
    const decided = domain.evaluateStageChain({
      route: 'code',
      level: 'L2',
      manifests,
      requirement: { requirementId },
    });
    ensure(
      decided.ok === true,
      `the L2 chain was rejected: ${JSON.stringify(decided.gaps ?? decided.code)}`,
    );
    ensure(
      JSON.stringify(decided.stages) ===
        JSON.stringify(['Plan', 'Develop', 'Review', 'Test', 'Settlement']),
      `the chain order is ${JSON.stringify(decided.stages)}`,
    );
    const withoutTest = domain.evaluateStageChain({
      route: 'code',
      level: 'L2',
      manifests: manifests.filter((manifest) => manifest.stage !== 'Test'),
      requirement: { requirementId },
    });
    ensure(withoutTest.ok === false, 'the chain rule accepted a missing Test stage');

    chainState.taskId = task.id;
    chainState.candidate = candidate;
    chainState.codeTree = codeTree;
    chainState.commitTree = commitTree;
    chainState.baseRevision = baseRevision;
    chainState.stageResults = stageResults;
    return `Work ${workId} + Requirement ${requirementId} bound; Task ${task.id}; candidate ${candidate.slice(0, 12)} tree ${commitTree.slice(0, 12)} codeTree ${codeTree.slice(0, 12)}; 5 real stage results (Plan/Develop/Review/Test/Settlement) accepted by StageGate; evaluateStageChain(route=code, level=L2) ok with the documented order and refuses a missing Test`;
  });

  // ---- C13: settlement of the L2 delivery ---------------------------------

  await checks.check('delivery.settlement', ['AC-010'], async () => {
    const workId = routingState.workId;
    const requirementId = requirementState.id;
    const expectedRevision = chainState.baseRevision;
    ensure(expectedRevision !== '', 'the delivery branch has no revision');

    const manifestId = store.newId();
    const built = core.buildFinalManifest({
      workId,
      requirementId,
      verifiedManifests: [
        {
          manifestId,
          workId,
          kind: 'task',
          codeRevision: chainState.candidate,
          codeTree: chainState.codeTree,
          acceptanceIds: ['AC-010'],
          valid: true,
          evidenceRefs: chainState.stageResults.map((entry) => entry.row.id),
        },
      ],
      finalRevision: chainState.candidate,
      finalTree: chainState.codeTree,
      knowledgeTree: storage.sha256('knowledge:before-patch'),
      settlementResultRef: store.newId(),
      riskDecisionIds: [],
      changedPaths: [{ path: CODE_PATH, change: 'modified' }],
      codeStartRevision: harness.seedRevision,
    });
    ensure(
      built.ok === true,
      `buildFinalManifest refused: ${JSON.stringify(built.reasons ?? built.code)}`,
    );
    const frozen = core.freezeFinalManifest({
      snapshots: harness.snapshots,
      manifest: built.manifest,
    });
    ensure(
      typeof frozen.hash === 'string' && frozen.hash.length === 64,
      'the final manifest was not frozen',
    );

    const settled = harness.settlement.settle({
      operationId: store.newId(),
      workId,
      requirementId,
      ref: DELIVERY_REF,
      expectedRevision,
      candidateRevision: chainState.candidate,
      candidateTree: chainState.codeTree,
      manifest: built.manifest,
      taskIds: [chainState.taskId],
      message: 'feat: make unpaid orders cancellable',
    });
    ensure(
      settled.ok === true,
      `settle refused: ${JSON.stringify(settled.reasons ?? settled.code)}`,
    );
    ensure(settled.refUpdated === true, 'the delivery ref was not moved');
    ensure(settled.codeTreeHash === chainState.codeTree, 'settlement reported another code tree');
    ensure(settled.commitTree === chainState.commitTree, 'settlement reported another Git tree');
    const now = revisionOf(harness.repo, DELIVERY_REF);
    ensure(now === chainState.candidate, `the delivery branch is at ${now}`);
    const settledRow = store.requirements.find(requirementId);
    ensure(
      settledRow?.lifecycle === 'completed',
      `the Requirement is ${String(settledRow?.lifecycle)}`,
    );
    ensure(settledRow?.phase === undefined, 'a completed Requirement kept its phase');
    const completionEvents = store.events
      .readAfter(0, { limit: 10_000 })
      .filter((event) => event.name === 'settlement.completed');
    ensure(
      completionEvents.length === 1,
      `expected one settlement event, found ${String(completionEvents.length)}`,
    );
    const reread = core.readFrozenFinalManifest(store, frozen.hash);
    ensure(
      reread?.finalRevision === chainState.candidate,
      'the frozen manifest does not read back',
    );
    return `CompletionManifest ${frozen.hash.slice(0, 12)} frozen; settle moved ${DELIVERY_REF} ${expectedRevision.slice(0, 12)} -> ${chainState.candidate.slice(0, 12)}; refUpdated=true commitTree=${String(settled.commitTree).slice(0, 12)} codeTree=${String(settled.codeTreeHash).slice(0, 12)}; Requirement completed with phase cleared; exactly one settlement.completed event`;
  });

  // ---- C14: knowledge patch visible on a cold start ------------------------

  await checks.check('knowledge.patch-cold-start', ['AC-041', 'AC-037'], async () => {
    const decisionId = store.decisions
      .list({ orderBy: 'created_at ASC' })
      .find((row) => row.state === 'accepted')?.id;
    ensure(typeof decisionId === 'string', 'no accepted Decision to cite');

    const baseMarkdown = git(['show', `${harness.seedRevision}:${FEATURE_PATH}`], harness.repo);
    const otherMarkdown = git(
      ['show', `${harness.seedRevision}:${OTHER_FEATURE_PATH}`],
      harness.repo,
    );
    const codeRevision = chainState.candidate;

    // The patch is rendered from parsed facts by the product's own knowledge rules,
    // then committed: the document's `revision` field names the code tree the
    // verification ran against.
    const built = core.buildKnowledgePatch({
      documentPath: FEATURE_PATH,
      currentMarkdown: baseMarkdown,
      baseRevision: harness.seedRevision,
      codeTreeRevision: codeRevision,
      knownIds: [decisionId],
      fields: {
        implementation: 'implemented',
        verification: 'passed',
        verificationEvidenceRefs: ['artifact:e2e-test-result@1'],
        verificationCoverage: ['未付款可取消', '已付款拒绝'],
        revision: codeRevision,
      },
      currentBehaviour: { text: '未付款订单可取消；已付款订单返回已确认的拒绝结果。' },
      entries: [CODE_PATH, CODE_PATH_V2],
      relations: [
        {
          targetFeatureId: OTHER_FEATURE_ID,
          kind: 'constrained_by',
          reason: '付款状态决定可取消范围',
          source: FEATURE_PATH,
        },
      ],
      invalidationNotes: ['原实现入口 src/orders/cancel-old.ts 已失效（AC-041 失效说明）'],
    });
    ensure(
      built.ok === true,
      `buildKnowledgePatch refused: ${JSON.stringify(built.errors ?? built.code)}`,
    );
    ensure(
      built.patch.changedFields.includes('entries') &&
        built.patch.changedFields.includes('invalidationNotes'),
      `the patch did not name entries/invalidationNotes: ${JSON.stringify(built.patch.changedFields)}`,
    );

    writeFileAt(harness.repo, FEATURE_PATH, built.patch.markdown);
    const knowledgeRevision = unwrap(
      gitPort.commitPaths(harness.repo, 'docs: settle the order-cancellation knowledge', [
        FEATURE_PATH,
      ]),
      'knowledge commit',
    ).revision;
    ensure(
      git(['show', `${knowledgeRevision}:${FEATURE_PATH}`], harness.repo).includes('implemented'),
      'the committed Feature document does not carry the new facts',
    );

    const documents = [
      { relativePath: FEATURE_PATH, markdown: built.patch.markdown },
      { relativePath: OTHER_FEATURE_PATH, markdown: otherMarkdown },
    ];
    const cache = core.createSqliteProjectionCache({ store });
    const applied = core.applyKnowledgePatch({
      patch: built.patch,
      documents,
      revision: knowledgeRevision,
      codeTreeRevision: codeRevision,
      documentRoot: DOCUMENT_ROOT,
      knownIds: [decisionId],
      cache,
    });
    ensure(
      applied.ok === true,
      `applyKnowledgePatch refused: ${JSON.stringify(applied.diagnostics ?? applied.code)}`,
    );
    ensure(applied.projection.state === 'valid', `the projection is ${applied.projection.state}`);
    ensure(
      cache.get(knowledgeRevision, FEATURE_ID)?.state === 'valid',
      'the durable cache row is not valid',
    );

    // Cold start: a projection built from the documents alone (no reuse of the
    // earlier object and a fresh cache) must answer from the patched knowledge.
    const cold = knowledge.buildProjection({
      documents,
      revision: knowledgeRevision,
      codeTreeRevision: codeRevision,
      documentRoot: DOCUMENT_ROOT,
      knownIds: [decisionId],
      cache: knowledge.createInMemoryProjectionCache(),
    });
    ensure(
      cold.published === true,
      `the cold projection was refused: ${JSON.stringify(cold.diagnostics)}`,
    );
    const coldAnswer = core.coldStartAnswer({
      projection: cold.projection,
      query: '未付款订单可以取消吗',
    });
    ensure(
      coldAnswer.ok === true,
      `coldStartAnswer refused: ${JSON.stringify(coldAnswer.errors ?? coldAnswer.code)}`,
    );
    const answer = coldAnswer.answer;
    ensure(
      answer.selectedFeatureIds.includes(FEATURE_ID),
      `the cold start selected ${JSON.stringify(answer.selectedFeatureIds)}`,
    );
    const behaviour = answer.currentBehaviour.find((fact) => fact.featureId === FEATURE_ID);
    ensure(
      behaviour?.text.includes('已付款订单返回已确认的拒绝结果'),
      `the cold start behaviour is "${String(behaviour?.text)}"`,
    );
    ensure(
      answer.entryPaths.codePaths.includes(CODE_PATH),
      `the cold start code entries are ${JSON.stringify(answer.entryPaths.codePaths)}`,
    );
    ensure(
      answer.entryPaths.testPaths.includes(CODE_PATH_V2),
      `the cold start test entries are ${JSON.stringify(answer.entryPaths.testPaths)}`,
    );
    ensure(
      answer.knownGaps.some((gap) => gap.description.includes('已失效')),
      `the cold start gaps are ${JSON.stringify(answer.knownGaps)}`,
    );
    ensure(
      answer.constraints.some((constraint) =>
        constraint.constraint.includes('付款状态决定可取消范围'),
      ),
      `the cold start constraints are ${JSON.stringify(answer.constraints)}`,
    );
    // The durable projection behind the API answers the same way.
    const durable = core.coldStartAnswer({
      projection: applied.projection,
      query: '未付款订单可以取消吗',
    });
    ensure(durable.ok === true, 'the durable projection could not answer a cold start');
    // The Docs surface reads the same published projection.
    const docs = await harness.accepted('knowledge.list', { view: 'delivered' });
    ensure(
      (docs.items ?? []).some((item) => item.featureId === FEATURE_ID),
      'the Docs surface does not list the patched Feature',
    );
    ensure(
      docs.projectionState === 'valid',
      `knowledge.list reports ${String(docs.projectionState)}`,
    );
    const docsPage = await harness.page(`/projects/${harness.projectId}/docs`);
    ensure(
      docsPage.html.includes(`data-feature="${FEATURE_ID}"`),
      'the Docs page lost the Feature',
    );
    return `knowledge commit ${knowledgeRevision.slice(0, 12)}: ${built.patch.changedFields.join(',')}; projection ${knowledgeRevision.slice(0, 12)} state=valid (durable SQLite row valid); cold start selected ${JSON.stringify(answer.selectedFeatureIds)} with "${String(behaviour?.text)}", code+test entries, the constrained_by constraint and the invalidation gap; knowledge.list state=valid`;
  });

  // ---- C15: the provider was never called (offline determinism) -------------

  await checks.check('offline.no-model-call', [], async () => {
    ensure(
      harness.providerCalls.length === 0,
      `the offline drill called the Provider stub: ${harness.providerCalls.join(', ')}`,
    );
    const probe = await harness.accepted('config.test', { role: 'chief' });
    ensure(probe.probe === 'capabilities-only', `config.test probe=${String(probe.probe)}`);
    ensure(
      harness.providerCalls.length === 0,
      `config.test called the Provider: ${harness.providerCalls.join(', ')}`,
    );
    return `provider stub at ${harness.providerBaseUrl} received 0 requests across the whole drill; config.test resolved chief to ${String(probe.providerId)}/${String(probe.modelId)} with probe=capabilities-only`;
  });

  // ---- Honest UNVERIFIED rows: what a headless runner cannot prove ----------

  checks.unverified(
    'browser.rendering-and-isolation',
    E2E_BROWSER_ISOLATION_ACS,
    'AC-002/AC-052 的真实浏览器渲染、脚本隔离与攻击样例需要浏览器环境（无头或真实）；本仓库按产品决定不引入 Playwright 或浏览器下载，因此这两项在本演练中未执行（已提交用例覆盖 CSP/sandbox 预览头、一次性下载 token 与截断）',
  );
  checks.unverified(
    'browser.viewport-and-keyboard',
    E2E_BROWSER_VIEWPORT_ACS,
    'AC-071 的 viewport 布局/焦点恢复与 AC-073 的键盘遍历/ARIA 实机朗读需要真实浏览器；本演练验证了三态面板标记与语言字典，未执行像素级与实机键盘检查',
  );
  checks.unverified(
    'browser.upload-client-hints',
    E2E_BROWSER_UPLOAD_ACS,
    'AC-076 的服务端拒绝（超类型 mime 无残留引用）已在本演练中执行并作为 attachment.upload-first-message 的证据；客户端提示文案需要浏览器执行，未验证',
  );
  checks.unverified(
    'provider.fact-and-unknown',
    E2E_PROVIDER_ACS,
    'AC-001 的“区分事实/未知”需要真实 Provider 纵向演练（pnpm test:live 与 AGENTDEV_PROVIDER_*）；本演练离线运行，Provider 桩被断言零调用',
  );
}

// ---------------------------------------------------------------------------
// Deterministic seed helpers (the shapes the Core services produce)
// ---------------------------------------------------------------------------

/** Seeds one Work with a real budget row, as the routing path does. */
function seedWork(harness, options = {}) {
  const { store } = harness;
  const id = store.newId();
  const budget = store.budgets.insert({
    projectId: harness.projectId,
    workId: id,
    tokenLimit: 500_000,
    tokensUsed: 0,
    tokensReserved: 0,
    activeTimeLimit: 7_200,
    activeTimeUsed: 0,
    repairLimit: 3,
    repairUsed: 0,
    costKnown: true,
  });
  return store.works.insert({
    id,
    projectId: harness.projectId,
    intent: options.intent ?? 'delivery',
    purpose: 'seed',
    level: options.level ?? 'L2',
    goal: options.goal ?? 'seed a work item',
    scope: {
      readPaths: ['src'],
      writePaths: ['src'],
      operations: ['read', 'edit'],
      networkTargets: [],
    },
    sourceRef: { kind: 'action', id: store.newId(), version: '1' },
    status: options.status ?? 'queued',
    blockerIds: [],
    baseRevision: harness.seedRevision,
    budgetId: budget.id,
    policyRevision: 1,
  });
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}
process.exit(await main(options));
