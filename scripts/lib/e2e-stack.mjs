/**
 * Boots the **real** AgentDev stack for the release drills (WP-10 T2) and the
 * real-browser suite (WP-12 T7a).
 *
 * One temporary Git project, one real SQLite `ProjectStore`, the real Core services,
 * the real `createDaemon` (HTTP + WebSocket) and the real `createWebApp` BFF, every
 * listener on loopback port 0 and every directory under the OS temp dir. The module
 * was extracted from `scripts/e2e.mjs` unchanged so the browser suite drives exactly
 * the same stack the headless drill does instead of a second, drifting fixture.
 *
 * Nothing here fakes product behaviour: it is temporary-directory, Git and transport
 * plumbing around the product's own sources (`scripts/lib/e2e-runtime.mjs` maps the
 * `@agentdev/*` specifiers onto them).
 */
import { createServer } from 'node:http';
import { join } from 'node:path';

import { ensure, git, httpRequest, jsonOf, makeTempDir, writeFileAt } from './e2e-runtime.mjs';

/** The exact `Origin` both the daemon and the BFF allow (`protocol.md` §2). */
export const WEB_ORIGIN = 'http://127.0.0.1:4317';
/** The Product's delivery branch (`ARCHITECTURE.md` §4). */
export const DELIVERY_REF = 'refs/heads/agentdev/main';
/** The knowledge document root of the temporary project. */
export const DOCUMENT_ROOT = 'docs/agentdev';
export const FEATURE_ID = 'F-0a1b2c3d';
export const OTHER_FEATURE_ID = 'F-0f0f0f0f';
export const FEATURE_PATH = `${DOCUMENT_ROOT}/features/${FEATURE_ID}/README.md`;
export const OTHER_FEATURE_PATH = `${DOCUMENT_ROOT}/features/${OTHER_FEATURE_ID}/README.md`;
export const CODE_PATH = 'src/orders/cancel.ts';
export const CODE_PATH_V2 = 'tests/orders/cancel.test.ts';

// ---------------------------------------------------------------------------
// Knowledge documents (the product's own Feature document format)
// ---------------------------------------------------------------------------

/** A valid Feature document (`context.md` §2) for the temporary project. */
export function featureMarkdown(input) {
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
// Boot: the real stack over a real temporary project
// ---------------------------------------------------------------------------

/**
 * Boots the real stack.
 *
 * @param {{
 *   product: Awaited<ReturnType<typeof import('./e2e-runtime.mjs').loadProduct>>,
 *   meta: Record<string, unknown>,
 *   options?: { allowedOrigins?: string[] },
 * }} input
 *   `options.allowedOrigins` is the BFF's exact-`Origin` allow list. It is passed
 *   through **by reference** and exposed on the harness, so a caller that learns the
 *   ephemeral BFF port only after `listen(0)` (the real-browser suite) can add its own
 *   origin; the headless drill keeps the documented `WEB_ORIGIN` only.
 */
export async function bootStack({ product, meta, options = {} }) {
  const {
    core,
    storage,
    workspace,
    knowledge,
    daemon: daemonModule,
    daemonProtocol,
    web: webModule,
  } = product;
  const allowedOrigins = options.allowedOrigins ?? [WEB_ORIGIN];

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

  // A *working* loopback model, used only by the runtime-execution check (C17): it proves
  // the daemon can execute a real Attempt without making the offline drill depend on a
  // Provider. It answers OpenAI-compatible JSON, and a prompt containing `SLOW` keeps the
  // answer back so the check can kill a live Runner.
  const localModelCalls = [];
  // The marker one drill message carries so the stub knows to answer with tool calls
  // (R3-2 / T2.7). It travels in the Work goal, which is what the Runner prompt carries.
  const MESSAGE_DRILL_MARKER = 'AGENTDEV-R32-TOOLCALL';
  const localModel = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      localModelCalls.push(body);
      const slow = body.includes('SLOW');
      // The no-seed control-channel drill (`R3-2`): a prompt carrying the marker is answered
      // with the tool calls a Chief/professional Run must make, one turn at a time. The
      // number of `tool` messages already in the request says which turn this is.
      const drill = body.includes(MESSAGE_DRILL_MARKER);
      const toolTurns = drill
        ? (JSON.parse(body).messages ?? []).filter((message) => message.role === 'tool').length
        : -1;
      const chiefTurn = drill && body.includes('AgentDev chief agent');
      const toolCall = (name, args) => ({
        id: `call_${name}`,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      });
      const drillMessage = (() => {
        if (!drill) return undefined;
        if (chiefTurn && toolTurns === 0) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              toolCall('assessment_submit', {
                intent: 'delivery',
                goal: 'deliver the dark theme',
                scope: {
                  readPaths: ['src'],
                  writePaths: ['src/theme.txt'],
                  operations: [],
                  networkTargets: [],
                },
                level: 'L2',
                semanticImpact: false,
                riskFlags: [],
                uncertainties: [],
                policyRevision: 1,
                reason: 'the user asked for the dark theme in plain language',
              }),
            ],
          };
        }
        if (chiefTurn && toolTurns === 1) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              toolCall('agent_dispatch', {
                role: 'backend',
                purpose: 'implementation',
                goal: 'write the dark theme file',
                scope: {
                  readPaths: ['src'],
                  writePaths: ['src/theme.txt'],
                  operations: [],
                  networkTargets: [],
                },
                stage: 'develop',
                contextSelection: {
                  goal: 'write the dark theme file',
                  sourceRefs: [],
                  reasonPerSource: {},
                  featureRefs: [],
                  codePaths: ['src/theme.txt'],
                  artifactRefs: [],
                  excluded: [],
                  unknowns: [],
                  readBudget: { initialTokens: 24000, expansionTokens: 16000 },
                },
                requiredOutputs: ['stage_result'],
                requiredChild: false,
                joinPolicy: 'none',
                budgetAllocation: 20000,
              }),
            ],
          };
        }
        if (!chiefTurn && toolTurns === 0) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [
              toolCall('stage_yield', {
                status: 'success',
                summary: 'the dark theme file is written',
                artifactRefs: [],
                evidenceRefs: [],
                changedPaths: ['src/theme.txt'],
                findingIds: [],
                unknowns: [],
                requestedActions: [],
                readLedgerSeq: 0,
                readLedgerHash: 'a'.repeat(64),
              }),
            ],
          };
        }
        return undefined;
      })();
      const answer = () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        const message = drillMessage ?? { role: 'assistant', content: 'E2E-LOCAL-ANSWER' };
        response.end(
          JSON.stringify({
            id: 'e2e-local-completion',
            object: 'chat.completion',
            model: 'e2e-local-model',
            choices: [
              {
                index: 0,
                message,
                finish_reason: message.tool_calls === undefined ? 'stop' : 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
          }),
        );
      };
      if (slow) setTimeout(answer, 30_000);
      else answer();
    });
  });
  await new Promise((resolve) => localModel.listen(0, '127.0.0.1', resolve));
  const localModelAddress = localModel.address();
  const localModelUrl = `http://127.0.0.1:${String(typeof localModelAddress === 'object' && localModelAddress !== null ? localModelAddress.port : 0)}`;

  // The snapshot writer must exist before anything freezes a configuration: the runtime
  // execution check (C17) freezes a role profile exactly like the daemon host does.
  const snapshots = new core.SnapshotWriter({ store });
  const config = core.ConfigStore.open({ globalDir: stateDir, projectRoot: dataDir, snapshots });
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
    // By reference: the BFF answers an Origin that is in this exact list, and the
    // real-browser suite adds the ephemeral origin it only learns after `listen(0)`.
    allowedOrigins,
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
    allowedOrigins,
    projectId,
    conversationId,
    installationToken,
    providerCalls,
    provider,
    localModel,
    localModelUrl,
    localModelCalls,
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
      await new Promise((resolve) => localModel.close(() => resolve()));
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
export function readFeatureDocuments(repo) {
  const read = (path) => ({
    relativePath: path,
    markdown: git(['show', `HEAD:${path}`], repo),
  });
  return [read(FEATURE_PATH), read(OTHER_FEATURE_PATH)];
}

// ---------------------------------------------------------------------------
// Deterministic seed helpers (the shapes the Core services produce)
// ---------------------------------------------------------------------------

/** Seeds one Work with a real budget row, as the routing path does. */
export function seedWork(harness, options = {}) {
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
